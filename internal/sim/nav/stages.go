package nav

import (
	"fmt"
	"math"
	"slices"
)

const (
	// bridgeReach: node pairs up to this far apart are checked for a gap.
	bridgeReach = 7.5
	// hopSlack: a pair d apart is joined well enough when the graph links
	// it in at most ceil(d/Spacing)+hopSlack hops.
	hopSlack = 4
	// maxDetour: a routed bridge may be at most this many times the straight
	// distance; anything longer is the long way round, not a gap.
	maxDetour = 1.6
	// brutePad is how far past a pair the 1- and 2-point search looks.
	brutePad = 1.0
	// bruteKeep caps the candidates per end in the 2-point search.
	bruteKeep = 300
	// bruteTries is how many of the best brute-force bridges get the full
	// check before the pair is given up.
	bruteTries = 16
	// bridgePasses bounds the rounds of gap bridging; new nodes can open new
	// pairs, so a second round catches those.
	bridgePasses = 3
)

// Stage 3: a chain of Crossing nodes over every crosswalk. Each kerb point on
// its centreline is routed to the nearest node on that side, both landings
// are pulled straight, and the chain runs landing, centreline, landing.
func (b *builder) crossings() error {
	for ci, cw := range b.m.Crosswalks {
		r := cw.Rect
		var ka, kb Point
		if cw.Axis == AxisZ {
			x := (r.MinX + r.MaxX) / 2
			ka, kb = Point{x, r.MinZ}, Point{x, r.MaxZ}
		} else {
			z := (r.MinZ + r.MaxZ) / 2
			ka, kb = Point{r.MinX, z}, Point{r.MaxX, z}
		}
		la, na := b.landing(ka, cw.Axis, -1)
		lb, nb := b.landing(kb, cw.Axis, 1)
		if na < 0 || nb < 0 {
			return fmt.Errorf("nav: crosswalk %d at %+v: no node to land on", ci, r)
		}
		slices.Reverse(lb)
		line := append(la, lb...)
		chain, ok := b.placeChain(line, na, nb, b.p.Margin)
		if !ok {
			chain, ok = b.placeChain(line, na, nb, 0)
		}
		if !ok {
			return fmt.Errorf("nav: crosswalk %d at %+v: no chain fits", ci, r)
		}
		before := b.components()
		ch := b.apply(chain, Crossing, nil)
		if b.hops(na, nb, len(chain)+1+hopSlack) < 0 || b.components() > before || !b.keeps(ch) {
			b.undo(ch)
			return fmt.Errorf("nav: crosswalk %d at %+v: chain does not link", ci, r)
		}
	}
	return nil
}

// landing routes from a kerb point to the nearest node on one side of the
// road (side -1 is towards smaller coordinates along axis) and returns the
// pulled path from that node to the kerb, and the node.
func (b *builder) landing(kerb Point, axis Axis, side float64) ([]Point, int32) {
	beyond := func(q Point) bool {
		if axis == AxisZ {
			return (q.Z-kerb.Z)*side >= -eps
		}
		return (q.X-kerb.X)*side >= -eps
	}
	window := Rect{kerb.X - landingPad, kerb.X + landingPad, kerb.Z - landingPad, kerb.Z + landingPad}
	obs := b.obs.near(window, b.p.Radius+b.p.Margin)
	onArea := func(q Point) bool {
		for _, a := range b.m.Areas {
			if inRect(a.Rect, q) {
				return true
			}
		}
		return false
	}
	free := func(q Point) bool {
		return beyond(q) && onArea(q) && obs.dist(q) >= b.p.Radius+b.p.Margin
	}
	snap := snapCells * b.p.Grid
	goal := func(q Point) int32 {
		for _, id := range b.ix.within(q, snap, b.pts, nil) {
			p := b.pts[id]
			if b.kinds[id] != Crossing && beyond(p) && b.walk.containsSeg(q, p) && obs.segDist(q, p) >= b.p.Radius {
				return id
			}
		}
		return -1
	}
	path, id := b.route(kerb, window, nil, math.MaxInt32, free, goal)
	if id < 0 {
		return nil, -1
	}
	// From the node out to the kerb.
	slices.Reverse(path)
	path = append([]Point{b.pts[id]}, path...)
	return pull(path, b.clearFor(obs)), id
}

// clearFor is the line-of-sight test for pulling a routed path straight: the
// segment stays walkable and keeps Radius+Margin from obstacles, or just
// Radius from the segment leaving the start node, which may sit closer.
func (b *builder) clearFor(obs obstacles) func(a, c Point, first bool) bool {
	return func(a, c Point, first bool) bool {
		need := b.p.Radius + b.p.Margin
		if first {
			need = b.p.Radius
		}
		return b.walk.containsSeg(a, c) && obs.segDist(a, c) >= need
	}
}

// gapPair is two nodes that might need a bridge.
type gapPair struct {
	i, j int32
	d    float64
}

// Stage 4: wherever two nodes a short walk apart are linked only the long way
// round (or not at all), add Bridge nodes between them. Pairs go shortest
// first; each attempt is all-or-nothing.
func (b *builder) bridges() {
	for pass := 0; pass < bridgePasses; pass++ {
		var pairs []gapPair
		for i := range b.pts {
			if !b.alive[i] {
				continue
			}
			for _, j := range b.ix.within(b.pts[i], bridgeReach, b.pts, nil) {
				if d := dist(b.pts[i], b.pts[j]); int(j) > i && d > b.p.MaxEdge {
					pairs = append(pairs, gapPair{int32(i), j, d})
				}
			}
		}
		slices.SortStableFunc(pairs, func(x, y gapPair) int { return cmpFloat(x.d, y.d) })
		added := false
		for _, pr := range pairs {
			if !b.alive[pr.i] || !b.alive[pr.j] {
				continue
			}
			// A gap has walkable ground straight across it (a lamp or a
			// building corner in the way); two chains either side of a road
			// junction are just far apart.
			if !b.walk.containsSeg(b.pts[pr.i], b.pts[pr.j]) {
				continue
			}
			limit := int(math.Ceil(pr.d/b.m.Spacing)) + hopSlack
			if b.hops(pr.i, pr.j, limit) >= 0 || !b.hasRoom(pr.i) || !b.hasRoom(pr.j) {
				continue
			}
			if b.bridge(pr.i, pr.j, limit) {
				added = true
			}
		}
		if !added {
			return
		}
	}
}

// hasRoom reports whether a new node could go within one step of node i at
// all: somewhere on walkable ground, Radius from obstacles and BridgeGap from
// every node but Fill ones, which a bridge may clear. Every bridge method
// adds a node in such a place next to one end of its pair (or links a
// waypoint, whose own pair is tried too), so a pair is skipped unless both
// ends have room. Cached per node until the graph next changes.
func (b *builder) hasRoom(i int32) bool {
	if n := len(b.pts); len(b.roomAt) < n {
		b.roomAt = append(b.roomAt, make([]bool, n-len(b.roomAt))...)
		b.roomVer = append(b.roomVer, slices.Repeat([]int{-1}, n-len(b.roomVer))...)
	}
	if b.roomVer[i] == b.version {
		return b.roomAt[i]
	}
	b.roomVer[i] = b.version
	b.roomAt[i] = false
	c, r, step := b.pts[i], b.p.MaxEdge, b.p.Grid/2
	for k := int(math.Ceil((c.Z - r) / step)); float64(k)*step <= c.Z+r; k++ {
		for l := int(math.Ceil((c.X - r) / step)); float64(l)*step <= c.X+r; l++ {
			q := Point{quantise(float64(l) * step), quantise(float64(k) * step)}
			if dist(q, c) > r || b.nearestSolid(q, b.p.BridgeGap) < b.p.BridgeGap {
				continue
			}
			if b.walk.contains(q) && b.obs.dist(q) >= b.p.Radius {
				b.roomAt[i] = true
				return true
			}
		}
	}
	return false
}

// nearestSolid is nearestDist ignoring Fill nodes.
func (b *builder) nearestSolid(p Point, limit float64) float64 {
	d := limit
	for _, id := range b.ix.within(p, limit, b.pts, nil) {
		if b.kinds[id] != Fill {
			d = min(d, dist(p, b.pts[id]))
		}
	}
	return d
}

// bridge tries, in order: a routed chain; the same after clearing Fill nodes
// off its path; one or two hand-placed points; the same after clearing the
// pair's window of Fill nodes. Stand nodes are never removed.
func (b *builder) bridge(i, j int32, limit int) bool {
	line := b.bridgeRoute(i, j)
	var kill []int32
	if line != nil {
		kill = b.fillsNear(line, i, j)
		if b.routedBridge(line, i, j, limit, kill, b.p.Margin) {
			b.version++
			return true
		}
	}
	if b.brute(i, j, limit, nil) {
		b.version++
		return true
	}
	if k := b.fillsIn(b.window(i, j, brutePad), i, j); len(k) > 0 && b.brute(i, j, limit, k) {
		b.stats.cleared += len(k)
		b.version++
		return true
	}
	// Last, a routed chain that may sit right at the limits.
	if line != nil && b.routedBridge(line, i, j, limit, kill, 0) {
		b.version++
		return true
	}
	b.stats.failed++
	return false
}

// routedBridge places a chain along a routed line, first as it is, then
// after clearing the Fill nodes in kill off it.
func (b *builder) routedBridge(line []Point, i, j int32, limit int, kill []int32, margin float64) bool {
	if b.tryChain(line, i, j, limit, nil, margin) {
		b.stats.routed++
		return true
	}
	if len(kill) > 0 && b.tryChain(line, i, j, limit, kill, margin) {
		b.stats.routedCleared++
		b.stats.cleared += len(kill)
		return true
	}
	return false
}

func (b *builder) window(i, j int32, pad float64) Rect {
	p, q := b.pts[i], b.pts[j]
	return Rect{min(p.X, q.X) - pad, max(p.X, q.X) + pad, min(p.Z, q.Z) - pad, max(p.Z, q.Z) + pad}
}

// bridgeRoute routes from i to j with Radius+Margin clearance and pulls the
// path straight, or returns nil if the only way is a long detour.
func (b *builder) bridgeRoute(i, j int32) []Point {
	// A path at most maxDetour times d long stays inside an ellipse round
	// the pair whose half-width is d*sqrt(maxDetour^2-1)/2.
	d := dist(b.pts[i], b.pts[j])
	window := b.window(i, j, min(routePad, d*math.Sqrt(maxDetour*maxDetour-1)/2+float64(b.p.Grid*snapCells)))
	obs := b.obs.near(window, b.p.Radius+b.p.Margin)
	free := func(q Point) bool {
		return b.walk.contains(q) && obs.dist(q) >= b.p.Radius+b.p.Margin
	}
	snap := snapCells * b.p.Grid
	to := b.pts[j]
	goal := func(q Point) int32 {
		if dist(q, to) <= snap && b.walk.containsSeg(q, to) && obs.segDist(q, to) >= b.p.Radius {
			return j
		}
		return -1
	}
	// A grid path is at most ~8% longer than the straight path it pulls to,
	// and costs 10 per cell of length; past this it can't be short enough.
	maxCost := int32(math.Ceil(maxDetour * dist(b.pts[i], to) / b.p.Grid * 10 * 1.1))
	path, id := b.route(b.pts[i], window, &to, maxCost, free, goal)
	if id < 0 {
		return nil
	}
	path = append(path, to)
	line := pull(path, b.clearFor(obs))
	if pathLength(line) > maxDetour*dist(b.pts[i], to) {
		return nil
	}
	return line
}

// tryChain places a chain along line, optionally after killing some Fill
// nodes, and keeps it only if it links the pair, joins pieces rather than
// splitting them, and leaves every touched node passable.
func (b *builder) tryChain(line []Point, i, j int32, limit int, kill []int32, margin float64) bool {
	before := b.components()
	var cleared *change
	if len(kill) > 0 {
		cleared = b.apply(nil, Fill, kill)
	}
	chain, ok := b.placeChain(line, i, j, margin)
	if ok {
		ch := b.apply(chain, Bridge, nil)
		if b.hops(i, j, limit) >= 0 && b.components() <= before && b.keeps(ch) && (cleared == nil || b.keeps(cleared)) {
			return true
		}
		b.undo(ch)
	}
	if cleared != nil {
		b.undo(cleared)
	}
	return false
}

// fillsNear lists the Fill nodes, other than the pair, within BridgeGap of
// the line: the ones a chain along it would crowd.
func (b *builder) fillsNear(line []Point, i, j int32) []int32 {
	var ids []int32
	for k := 1; k < len(line); k++ {
		mid := lerp(line[k-1], line[k], 0.5)
		for _, id := range b.ix.within(mid, dist(line[k-1], line[k])/2+b.p.BridgeGap, b.pts, nil) {
			if id != i && id != j && b.kinds[id] == Fill && segPointDist(b.pts[id], line[k-1], line[k]) < b.p.BridgeGap {
				ids = append(ids, id)
			}
		}
	}
	slices.Sort(ids)
	return slices.Compact(ids)
}

// fillsIn lists the Fill nodes, other than the pair, inside r.
func (b *builder) fillsIn(r Rect, i, j int32) []int32 {
	var ids []int32
	for id := range b.pts {
		if b.alive[id] && b.kinds[id] == Fill && int32(id) != i && int32(id) != j && inRect(r, b.pts[id]) {
			ids = append(ids, int32(id))
		}
	}
	return ids
}

// bruteCand is a point a hand-placed bridge could use, with its own slack.
type bruteCand struct {
	p     Point
	slack float64
}

// brute searches a fine grid (step Grid/2) round the pair for one point, then
// two, that join i to j, scoring each by its smallest slack against every
// limit (obstacles, spacing, edges brushing nodes, passing through), and
// gives the best few the full check.
func (b *builder) brute(i, j int32, limit int, kill []int32) bool {
	before := b.components()
	var cleared *change
	if len(kill) > 0 {
		cleared = b.apply(nil, Fill, kill)
	}
	pi, pj := b.pts[i], b.pts[j]
	if dist(pi, pj) > 3*b.p.MaxEdge {
		// Two points make three steps at most.
		if cleared != nil {
			b.undo(cleared)
		}
		return false
	}
	window := b.window(i, j, brutePad)
	obs := b.obs.near(window, b.p.MaxEdge)
	step := b.p.Grid / 2

	// segSlack is how much room a segment has, or -1 if it breaks the edge rule.
	segSlack := func(a, c Point, skipA, skipB int32) float64 {
		d := dist(a, c)
		if d > b.p.MaxEdge || !b.walk.containsSeg(a, c) {
			return -1
		}
		s := obs.segDist(a, c) - b.p.Radius
		mid := lerp(a, c, 0.5)
		for _, k := range b.ix.within(mid, d/2+b.p.MinSep+b.p.BridgeGap, b.pts, nil) {
			if k != skipA && k != skipB {
				s = min(s, segPointDist(b.pts[k], a, c)-b.p.MinSep)
			}
		}
		return s
	}
	passSlack := func(a, v, c Point) float64 {
		return min(Swept(a, v, v, c), Swept(c, v, v, a)) - b.p.MinSep
	}

	var ends [2][]bruteCand
	for k := int(math.Ceil(window.MinZ / step)); float64(k)*step <= window.MaxZ; k++ {
		for l := int(math.Ceil(window.MinX / step)); float64(l)*step <= window.MaxX; l++ {
			q := Point{quantise(float64(l) * step), quantise(float64(k) * step)}
			// Cheapest and most selective tests first.
			if dist(q, pi) > b.p.MaxEdge && dist(q, pj) > b.p.MaxEdge {
				continue
			}
			s := b.nearestDist(q, 2*b.p.BridgeGap) - b.p.BridgeGap
			if s < 0 || !b.walk.contains(q) {
				continue
			}
			if s = min(s, obs.dist(q)-b.p.Radius); s < 0 {
				continue
			}
			for e, end := range [2]int32{i, j} {
				if dist(q, b.pts[end]) <= b.p.MaxEdge {
					if es := segSlack(q, b.pts[end], -1, end); es >= 0 {
						ends[e] = append(ends[e], bruteCand{q, min(s, es)})
					}
				}
			}
		}
	}

	// The best bruteTries options, most slack first; ties keep the order
	// found, so the pick is deterministic without sorting every option.
	type option struct {
		pts   []Point
		slack float64
	}
	var opts []option
	offer := func(s float64, pts ...Point) {
		if len(opts) == bruteTries && s <= opts[len(opts)-1].slack {
			return
		}
		k := len(opts)
		for k > 0 && opts[k-1].slack < s {
			k--
		}
		opts = slices.Insert(opts, k, option{pts, s})
		if len(opts) > bruteTries {
			opts = opts[:bruteTries]
		}
	}
	for _, c := range ends[0] {
		if dist(c.p, pj) > b.p.MaxEdge {
			continue
		}
		if es := segSlack(c.p, pj, -1, j); es >= 0 {
			if s := min(c.slack, es, passSlack(pi, c.p, pj)); s >= 0 {
				offer(s, c.p)
			}
		}
	}
	if len(opts) == 0 {
		for e := range ends {
			slices.SortStableFunc(ends[e], func(x, y bruteCand) int { return cmpFloat(y.slack, x.slack) })
			ends[e] = ends[e][:min(len(ends[e]), bruteKeep)]
		}
		for _, p := range ends[0] {
			for _, q := range ends[1] {
				d := dist(p.p, q.p)
				if d < b.p.BridgeGap || d > b.p.MaxEdge {
					continue
				}
				s := min(p.slack, q.slack, d-b.p.BridgeGap)
				if len(opts) == bruteTries && s <= opts[len(opts)-1].slack {
					continue // can't make the list
				}
				if s = min(s, passSlack(pi, p.p, q.p), passSlack(p.p, q.p, pj)); s < 0 {
					continue
				}
				// The new points brush each other's edges too.
				s = min(s, segPointDist(q.p, pi, p.p)-b.p.MinSep, segPointDist(p.p, q.p, pj)-b.p.MinSep)
				if s < 0 {
					continue
				}
				if ps := segSlack(p.p, q.p, -1, -1); ps >= 0 {
					offer(min(s, ps), p.p, q.p)
				}
			}
		}
	}
	for _, o := range opts {
		ch := b.apply(o.pts, Bridge, nil)
		if b.hops(i, j, limit) >= 0 && b.components() <= before && b.keeps(ch) && (cleared == nil || b.keeps(cleared)) {
			if len(o.pts) == 1 {
				b.stats.brute1++
			} else {
				b.stats.brute2++
			}
			return true
		}
		b.undo(ch)
	}
	if cleared != nil {
		b.undo(cleared)
	}
	return false
}

// prune removes nodes that ended up cut off from Stand node 0: a Fill cell
// in a pocket nothing reaches is no use to anyone. Stand nodes stay, and
// reachable reports them.
func (b *builder) prune() {
	if len(b.pts) == 0 {
		return
	}
	b.resetSearch()
	b.mark(0, 0)
	b.queue = append(b.queue[:0], 0)
	for head := 0; head < len(b.queue); head++ {
		for _, w := range b.adj[b.queue[head]] {
			if b.seen[w] != b.stamp {
				b.mark(w, 0)
				b.queue = append(b.queue, w)
			}
		}
	}
	var kill []int32
	for i := range b.pts {
		if b.alive[i] && b.kinds[i] != Stand && b.seen[i] != b.stamp {
			kill = append(kill, int32(i))
		}
	}
	if len(kill) > 0 {
		b.apply(nil, Fill, kill)
	}
}

// trim fixes the corridor corners no node can be added to (the park's
// south-east corner, where the sidewalk row and the lawn's grid meet 1.5
// apart): a corridor node whose two edges turn too sharply for a queue to
// walk through drops one of them and becomes a dead end, where a blob steps
// in and back out. An edge is only
// dropped if the graph stays in one piece and its other end still passes;
// the busier neighbour loses its edge first, to keep the most cycles.
// Dropped edges are final, so trim runs after the last relink.
func (b *builder) trim() error {
	pieces := b.components()
	for v := range b.pts {
		if !b.alive[v] || b.passes(int32(v)) {
			continue
		}
		ends := slices.Clone(b.adj[v])
		slices.SortStableFunc(ends, func(x, y int32) int { return len(b.adj[y]) - len(b.adj[x]) })
		ok := false
		for _, x := range ends {
			b.unlink(int32(v), x)
			if b.passes(x) && b.components() == pieces {
				ok = true
				b.stats.trimmed++
				break
			}
			b.link(int32(v), x)
		}
		if !ok {
			q := b.pts[v]
			return fmt.Errorf("nav: node %d at (%.3f, %.3f) turns too sharply between %d and %d for a queue to pass, and neither edge can go",
				v, q.X, q.Z, b.adj[v][0], b.adj[v][1])
		}
	}
	return nil
}

func (b *builder) unlink(u, v int32) {
	b.adj[u] = slices.DeleteFunc(b.adj[u], func(w int32) bool { return w == v })
	b.adj[v] = slices.DeleteFunc(b.adj[v], func(w int32) bool { return w == u })
}

func (b *builder) link(u, v int32) {
	for _, e := range [2][2]int32{{u, v}, {v, u}} {
		k, _ := slices.BinarySearch(b.adj[e[0]], e[1])
		b.adj[e[0]] = slices.Insert(b.adj[e[0]], k, e[1])
	}
}

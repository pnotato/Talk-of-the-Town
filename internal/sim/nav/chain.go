package nav

import (
	"container/heap"
	"math"
	"slices"
)

// Chains are the nodes Build adds to cross a road or a gap: route a path on
// a fine grid, pull it straight, then pick nodes along it.

const (
	// reuseDist: an existing node this close to a chain's path is a candidate
	// waypoint, so the chain runs through it instead of crowding it.
	reuseDist = 1.0
	// routePad is how far a routing window reaches past the points it joins.
	routePad = 3.0
	// landingPad is how far from its kerb point a crosswalk landing looks
	// for a node; a kiosk can push the nearest one a few metres off.
	landingPad = 6.0
	// snapCells: a routed path reaches a node when it is within this many
	// grid cells of it.
	snapCells = 1.5
	// spacingWeight trades a chain's evenness against its node count: one
	// node fewer is worth any spacing.
	nodeCost = 10.0
)

// gridCell is a routing grid cell on the open list: its priority (cost so
// far plus the heuristic), its cost so far, and its index.
type gridCell struct {
	prio, cost, idx int32
}

type cellHeap []gridCell

func (h cellHeap) Len() int { return len(h) }
func (h cellHeap) Less(i, j int) bool {
	if h[i].prio != h[j].prio {
		return h[i].prio < h[j].prio
	}
	return h[i].idx < h[j].idx
}
func (h cellHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *cellHeap) Push(x any)   { *h = append(*h, x.(gridCell)) }
func (h *cellHeap) Pop() any {
	old := *h
	c := old[len(old)-1]
	*h = old[:len(old)-1]
	return c
}

// Routing cell states.
const (
	cellUnknown uint8 = iota
	cellOpen
	cellBlocked
	cellDone
)

// routeScratch is reused across routes so a build allocates it once.
type routeScratch struct {
	state []uint8
	cost  []int32
	from  []int32
	heap  cellHeap
}

// route finds a cheapest 8-connected path on a grid of step Grid through
// start, inside window, over cells free() accepts (start always is). Orthogonal
// steps cost 10 and diagonal ones 14; ties go to the lower cell index. It
// stops at the first settled cell for which goal returns a node id >= 0 and
// returns the cells from start to there, and that id. With a target it is
// A*, aiming there (the goal must lie within snapCells of it); without, it
// is Dijkstra, for goals anywhere. It gives up once no path can cost less
// than maxCost.
func (b *builder) route(start Point, window Rect, target *Point, maxCost int32, free func(Point) bool, goal func(Point) int32) ([]Point, int32) {
	g := b.p.Grid
	i0 := int(math.Floor((window.MinX - start.X) / g))
	i1 := int(math.Ceil((window.MaxX - start.X) / g))
	j0 := int(math.Floor((window.MinZ - start.Z) / g))
	j1 := int(math.Ceil((window.MaxZ - start.Z) / g))
	w, h := i1-i0+1, j1-j0+1
	at := func(idx int32) Point {
		i, j := int(idx)%w+i0, int(idx)/w+j0
		return Point{start.X + float64(float64(i)*g), start.Z + float64(float64(j)*g)}
	}
	// The octile distance to the target's cell, less the snap, so it never
	// overestimates; 0 for Dijkstra.
	heur := func(int32) int32 { return 0 }
	if target != nil {
		ti := int(math.Round((target.X-start.X)/g)) - i0
		tj := int(math.Round((target.Z-start.Z)/g)) - j0
		slack := int32(math.Ceil(snapCells)) * 14
		heur = func(idx int32) int32 {
			di, dj := int32(abs(int(idx)%w-ti)), int32(abs(int(idx)/w-tj))
			return max(10*max(di, dj)+4*min(di, dj)-slack, 0)
		}
	}

	sc := &b.scratch
	n := w * h
	if cap(sc.state) < n {
		sc.state, sc.cost, sc.from = make([]uint8, n), make([]int32, n), make([]int32, n)
	}
	state, cost, from := sc.state[:n], sc.cost[:n], sc.from[:n]
	clear(state)
	s := int32((-j0)*w + (-i0))
	state[s] = cellOpen
	cost[s] = 0
	from[s] = -1
	pq := &sc.heap
	*pq = append((*pq)[:0], gridCell{heur(s), 0, s})
	for pq.Len() > 0 {
		c := heap.Pop(pq).(gridCell)
		if c.prio > maxCost {
			break
		}
		if state[c.idx] == cellDone || c.cost != cost[c.idx] {
			continue
		}
		state[c.idx] = cellDone
		if id := goal(at(c.idx)); id >= 0 {
			var path []Point
			for k := c.idx; k >= 0; k = from[k] {
				path = append(path, at(k))
			}
			slices.Reverse(path)
			return path, id
		}
		ci, cj := int(c.idx)%w, int(c.idx)/w
		for dj := -1; dj <= 1; dj++ {
			for di := -1; di <= 1; di++ {
				ni, nj := ci+di, cj+dj
				if (di == 0 && dj == 0) || ni < 0 || nj < 0 || ni >= w || nj >= h {
					continue
				}
				nx := int32(nj*w + ni)
				switch state[nx] {
				case cellUnknown:
					state[nx] = cellBlocked
					if free(at(nx)) {
						state[nx] = cellOpen
						cost[nx] = math.MaxInt32
					}
					if state[nx] != cellOpen {
						continue
					}
				case cellOpen:
				default:
					continue
				}
				step := int32(10)
				if di != 0 && dj != 0 {
					step = 14
				}
				if nc := c.cost + step; nc < cost[nx] {
					cost[nx] = nc
					from[nx] = c.idx
					heap.Push(pq, gridCell{nc + heur(nx), nc, nx})
				}
			}
		}
	}
	return nil, -1
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// pull straightens a path: from each corner it jumps to the farthest later
// point clear() can see. Neighbouring points are always taken, so it never
// fails; the result keeps the first and last points.
func pull(path []Point, clear func(a, b Point, first bool) bool) []Point {
	if len(path) < 3 {
		return path
	}
	out := []Point{path[0]}
	for i := 0; i < len(path)-1; {
		j := len(path) - 1
		for ; j > i+1; j-- {
			if clear(path[i], path[j], i == 0) {
				break
			}
		}
		out = append(out, path[j])
		i = j
	}
	return out
}

func pathLength(line []Point) float64 {
	l := 0.0
	for k := 1; k < len(line); k++ {
		l += dist(line[k-1], line[k])
	}
	return l
}

// chainCand is a place a chain node could go: a point along the line at arc
// length s, either new (id -1) or an existing node near the line.
type chainCand struct {
	p  Point
	s  float64
	id int32
}

// placeChain picks the nodes of a chain along line, which runs from node
// from to node to: as few new nodes as it takes, each step at most MaxEdge
// and as close to ChainStep as it can, new nodes at least BridgeGap from any
// other, every step passing the edge rule, and every new node letting a
// queue walk through it. Existing nodes near the line may be used on the
// way. It returns the new points in order, or false.
func (b *builder) placeChain(line []Point, from, to int32) ([]Point, bool) {
	cum := make([]float64, len(line))
	for k := 1; k < len(line); k++ {
		cum[k] = cum[k-1] + dist(line[k-1], line[k])
	}
	total := cum[len(cum)-1]
	pointAt := func(s float64) Point {
		k := 1
		for k < len(line)-1 && cum[k] < s {
			k++
		}
		seg := cum[k] - cum[k-1]
		if seg == 0 {
			return line[k]
		}
		return lerp(line[k-1], line[k], (s-cum[k-1])/seg)
	}
	// project returns the distance from p to the line and its arc length there.
	project := func(p Point) (float64, float64) {
		best, at := math.Inf(1), 0.0
		for k := 1; k < len(line); k++ {
			if d := segPointDist(p, line[k-1], line[k]); d < best {
				t := min(max(segParam(p, line[k-1], line[k]), 0), 1)
				best, at = d, cum[k-1]+float64(t*(cum[k]-cum[k-1]))
			}
		}
		return best, at
	}

	cands := []chainCand{{b.pts[from], 0, from}}
	var near []int32
	for k := 1; k < len(line); k++ {
		mid := lerp(line[k-1], line[k], 0.5)
		near = b.ix.within(mid, dist(line[k-1], line[k])/2+reuseDist, b.pts, near)
	}
	slices.Sort(near)
	for _, id := range slices.Compact(near) {
		if id == from || id == to {
			continue
		}
		if d, s := project(b.pts[id]); d <= reuseDist {
			cands = append(cands, chainCand{b.pts[id], s, id})
		}
	}
	for k := 1; ; k++ {
		s := float64(float64(k) * b.p.Grid)
		if s >= total {
			break
		}
		q := quantisePoint(pointAt(s))
		if b.walk.contains(q) && b.obs.dist(q) >= b.p.Radius && b.nearestDist(q, b.p.BridgeGap) >= b.p.BridgeGap {
			cands = append(cands, chainCand{q, s, -1})
		}
	}
	cands = append(cands, chainCand{b.pts[to], total, to})
	slices.SortStableFunc(cands, func(x, y chainCand) int { return cmpFloat(x.s, y.s) })
	// from and to stay first and last even if a waypoint projects onto an end.
	n := len(cands)
	if cands[0].id != from || cands[n-1].id != to {
		return nil, false
	}

	// Steps the chain may take, forward along the line.
	succ := make([][]int, n)
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			d := dist(cands[i].p, cands[j].p)
			if d > b.p.MaxEdge || d < b.p.MinSep {
				continue
			}
			if (cands[i].id < 0 || cands[j].id < 0) && d < b.p.BridgeGap {
				continue
			}
			if b.segmentOK(cands[i].p, cands[j].p, cands[i].id, cands[j].id) {
				succ[i] = append(succ[i], j)
			}
		}
	}

	// Cheapest chain over states (previous, current).
	type state struct {
		prev, cur int
		cost      float64
		back      int
	}
	var states []state
	slot := make([]map[int]int, n) // per current candidate: previous -> state
	for k := range slot {
		slot[k] = map[int]int{}
	}
	states = append(states, state{-1, 0, 0, -1})
	slot[0][-1] = 0
	byCur := make([][]int, n)
	byCur[0] = []int{0}
	for cur := 0; cur < n-1; cur++ {
		for _, si := range byCur[cur] {
			st := states[si]
			c := cands[cur]
			for _, nx := range succ[cur] {
				nc := cands[nx]
				if c.id < 0 && st.prev >= 0 {
					pp := cands[st.prev].p
					if Swept(pp, c.p, c.p, nc.p) < b.p.MinSep || Swept(nc.p, c.p, c.p, pp) < b.p.MinSep {
						continue
					}
				}
				d := dist(c.p, nc.p) - b.p.ChainStep
				cost := st.cost + float64(d*d)
				if nc.id < 0 {
					cost += nodeCost
				}
				if k, ok := slot[nx][cur]; ok {
					if cost < states[k].cost {
						states[k].cost, states[k].back = cost, si
					}
					continue
				}
				slot[nx][cur] = len(states)
				byCur[nx] = append(byCur[nx], len(states))
				states = append(states, state{cur, nx, cost, si})
			}
		}
	}
	best := -1
	for _, si := range byCur[n-1] {
		if best < 0 || states[si].cost < states[best].cost {
			best = si
		}
	}
	if best < 0 {
		return nil, false
	}
	var chain []Point
	for si := best; si >= 0; si = states[si].back {
		if c := cands[states[si].cur]; c.id < 0 {
			chain = append(chain, c.p)
		}
	}
	slices.Reverse(chain)
	for i := range chain {
		for j := i + 1; j < len(chain); j++ {
			if dist(chain[i], chain[j]) < b.p.BridgeGap {
				return nil, false
			}
		}
	}
	return chain, true
}

// change records one all-or-nothing edit to the graph so it can be undone.
type change struct {
	start   int
	killed  []int32
	saved   []int32
	oldAdj  [][]int32
	changed []int32 // live nodes whose neighbours differ afterwards, new ones included
}

// apply kills the given nodes, adds new ones of kind k, and relinks every
// node whose edges that can affect.
func (b *builder) apply(add []Point, k Kind, kill []int32) *change {
	at := make([]Point, 0, len(add)+len(kill))
	at = append(at, add...)
	for _, id := range kill {
		at = append(at, b.pts[id])
	}
	ch := &change{start: len(b.pts), killed: kill}
	ch.saved = b.touched(at)
	for _, id := range ch.saved {
		ch.oldAdj = append(ch.oldAdj, b.adj[id])
	}
	for _, id := range kill {
		b.kill(id)
	}
	for _, p := range add {
		b.add(p, k)
	}
	for _, id := range b.touched(at) {
		b.relink(id)
		if int(id) >= ch.start {
			ch.changed = append(ch.changed, id)
			continue
		}
		if k, ok := slices.BinarySearch(ch.saved, id); !ok || !slices.Equal(ch.oldAdj[k], b.adj[id]) {
			ch.changed = append(ch.changed, id)
		}
	}
	return ch
}

// undo reverts a change; changes must be undone newest first.
func (b *builder) undo(ch *change) {
	for id := len(b.pts) - 1; id >= ch.start; id-- {
		b.ix.remove(int32(id), b.pts[id])
	}
	b.pts = b.pts[:ch.start]
	b.kinds = b.kinds[:ch.start]
	b.alive = b.alive[:ch.start]
	b.adj = b.adj[:ch.start]
	for _, id := range ch.killed {
		b.revive(id)
	}
	for k, id := range ch.saved {
		b.adj[id] = ch.oldAdj[k]
	}
}

// keeps reports whether a change left every node it touched passable. A
// node's neighbours count as touched too: whether a corner is a corridor
// depends on the edge between its neighbours.
func (b *builder) keeps(ch *change) bool {
	for _, id := range ch.changed {
		if !b.passes(id) {
			return false
		}
		for _, n := range b.adj[id] {
			if !b.passes(n) {
				return false
			}
		}
	}
	return true
}

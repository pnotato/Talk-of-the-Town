package nav

import (
	"fmt"
	"math"
	"slices"
)

// guard is the margin Build keeps inside every limit CheckGraph tests.
const guard = 1e-7

// buildStats counts what the stages did, for tests and the docs.
type buildStats struct {
	routed, routedCleared int // bridges placed along a routed path, without and with clearing fills
	brute1, brute2        int // bridges of one or two hand-placed points
	failed                int // gap pairs no bridge could join
	cleared               int // Fill nodes removed to make room for bridges
	trimmed               int // corridor corners cut to dead ends
}

// builder holds the graph while Build grows it. Edges are never stored as
// choices: they follow from the nodes by one rule (linkable), and adj caches
// that rule's result for every live node.
type builder struct {
	m     Map
	p     Params
	walk  union
	obs   obstacles
	pts   []Point
	kinds []Kind
	alive []bool
	ix    *nodeIndex
	adj   [][]int32

	stats   buildStats
	scratch routeScratch

	// Scratch for breadth-first searches, reset by bumping stamp.
	seen  []uint32
	depth []int32
	stamp uint32
	queue []int32
}

func newBuilder(m Map, p Params) (*builder, error) {
	if err := validate(m, p); err != nil {
		return nil, err
	}
	rects := make([]Rect, 0, len(m.Areas)+len(m.Crosswalks))
	for _, a := range m.Areas {
		rects = append(rects, a.Rect)
	}
	for _, c := range m.Crosswalks {
		rects = append(rects, c.Rect)
	}
	bounds := rects[0]
	for _, r := range rects[1:] {
		bounds = Rect{min(bounds.MinX, r.MinX), max(bounds.MaxX, r.MaxX), min(bounds.MinZ, r.MinZ), max(bounds.MaxZ, r.MaxZ)}
	}
	return &builder{
		m:    m,
		p:    p,
		walk: newUnion(rects),
		obs:  obstacles{discs: m.Discs, boxes: m.Boxes},
		ix:   newNodeIndex(bounds, p.MaxEdge+p.MinSep),
	}, nil
}

func validate(m Map, p Params) error {
	switch {
	case !(p.Radius > 0 && p.MinSep > 0 && p.Grid > 0):
		return fmt.Errorf("nav: Radius, MinSep and Grid must be positive: %+v", p)
	case !(p.FillGap >= p.MinSep && p.BridgeGap >= p.MinSep):
		return fmt.Errorf("nav: FillGap and BridgeGap must be at least MinSep: %+v", p)
	case !(p.ChainStep >= p.BridgeGap && p.ChainStep <= p.MaxEdge):
		return fmt.Errorf("nav: ChainStep must lie in [BridgeGap, MaxEdge]: %+v", p)
	case !(m.Spacing >= p.MinSep && m.Spacing <= p.MaxEdge):
		return fmt.Errorf("nav: grid spacing %v must lie in [MinSep, MaxEdge]", m.Spacing)
	case len(m.Areas) == 0:
		return fmt.Errorf("nav: map has no areas")
	}
	for i, a := range m.Areas {
		if !(a.Rect.MinX < a.Rect.MaxX && a.Rect.MinZ < a.Rect.MaxZ) {
			return fmt.Errorf("nav: area %d (%s) has an empty rect %+v", i, a.Name, a.Rect)
		}
	}
	for i, c := range m.Crosswalks {
		if !(c.Rect.MinX < c.Rect.MaxX && c.Rect.MinZ < c.Rect.MaxZ) || c.Axis > AxisZ {
			return fmt.Errorf("nav: crosswalk %d is malformed: %+v", i, c)
		}
	}
	return nil
}

// Build turns a map into a walk graph:
//
//  1. every standing spot becomes a Stand node, in order;
//  2. each area's hex grid is filled in where spots were left out (in front
//     of doors, near trees) as Fill nodes;
//  3. each crosswalk gets a chain of Crossing nodes from kerb to kerb;
//  4. gaps the graph only links the long way round (block corners) are
//     bridged with Bridge nodes;
//  5. edges join every pair of nodes a blob can walk between in one step
//     without leaving the ground, touching an obstacle or brushing past a
//     third node.
//
// The result passes Check. Build is pure and deterministic.
func Build(m Map, p Params) (*Graph, error) {
	b, err := newBuilder(m, p)
	if err != nil {
		return nil, err
	}
	if err := b.run(); err != nil {
		return nil, err
	}
	pts, kinds, edges := b.export()
	g, err := FromEdges(pts, kinds, edges, p)
	if err != nil {
		return nil, err
	}
	if err := Check(g, p, &m); err != nil {
		return nil, fmt.Errorf("nav: built graph fails its check: %w", err)
	}
	return g, nil
}

func (b *builder) run() error {
	b.stands()
	b.fill()
	b.relinkAll()
	if err := b.crossings(); err != nil {
		return err
	}
	b.bridges()
	b.prune()
	b.relinkAll()
	if err := b.trim(); err != nil {
		return err
	}
	return b.reachable()
}

func (b *builder) add(p Point, k Kind) int32 {
	id := int32(len(b.pts))
	b.pts = append(b.pts, p)
	b.kinds = append(b.kinds, k)
	b.alive = append(b.alive, true)
	b.adj = append(b.adj, nil)
	b.ix.add(id, p)
	return id
}

func (b *builder) kill(id int32) {
	b.alive[id] = false
	b.adj[id] = nil
	b.ix.remove(id, b.pts[id])
}

func (b *builder) revive(id int32) {
	b.alive[id] = true
	b.ix.add(id, b.pts[id])
}

// nearestDist is how far p is from the closest live node, up to limit.
func (b *builder) nearestDist(p Point, limit float64) float64 {
	return b.ix.nearest(p, limit, b.pts)
}

// Stage 1: the standing spots, in order, are nodes 0..n-1.
func (b *builder) stands() {
	for _, a := range b.m.Areas {
		for _, s := range a.Spots {
			b.add(s, Stand)
		}
	}
}

// Stage 2: rebuild each area's hex grid from its first spot and add every
// cell a blob fits on that isn't crowding a node already there. Spots keep a
// blob's reach from obstacles so it can idle; a blob only passing through
// needs its radius, so this fills the gaps spots leave in front of doors and
// along the park's edge. Cells keep a radius from the walkable outline, not
// from the area's own rect: where a lawn meets its sidewalk there is no kerb.
func (b *builder) fill() {
	s := b.m.Spacing
	row := float64(s*math.Sqrt(3)) / 2
	for _, a := range b.m.Areas {
		if len(a.Spots) == 0 {
			continue
		}
		o := a.Spots[0]
		r0 := int(math.Floor((a.Rect.MinZ - o.Z) / row))
		r1 := int(math.Ceil((a.Rect.MaxZ - o.Z) / row))
		for r := r0; r <= r1; r++ {
			z := quantise(o.Z + float64(float64(r)*row))
			shift := 0.0
			if r%2 != 0 {
				shift = s / 2
			}
			c0 := int(math.Floor((a.Rect.MinX - o.X - shift) / s))
			c1 := int(math.Ceil((a.Rect.MaxX - o.X - shift) / s))
			for c := c0; c <= c1; c++ {
				q := Point{quantise(o.X + float64(float64(c)*s) + shift), z}
				if !inRect(a.Rect, q) || b.walk.edgeDist(q) < b.p.Radius || b.obs.dist(q) < b.p.Radius ||
					b.nearestDist(q, b.p.FillGap) < b.p.FillGap {
					continue
				}
				b.add(q, Fill)
			}
		}
	}
}

// linkable is the edge rule: i and j are one step apart, and a blob walking
// between them stays on walkable ground, keeps its radius from obstacles and
// never comes within MinSep of a blob standing on any other node.
func (b *builder) linkable(i, j int32) bool {
	// Always the same way round, so rounding can't make i link j but not j i.
	if i > j {
		i, j = j, i
	}
	return b.segmentOK(b.pts[i], b.pts[j], i, j)
}

// segmentOK applies the edge rule to a segment whose ends may not be nodes
// yet; skipA and skipB are the node ids at its ends, or -1.
func (b *builder) segmentOK(a, c Point, skipA, skipB int32) bool {
	// CheckGraph measures with math.Hypot and Swept, which can round a hair
	// differently, so stay guard clear of every limit it tests.
	d := dist(a, c)
	if d > b.p.MaxEdge-guard || !b.walk.containsSeg(a, c) || b.obs.segDist(a, c) < b.p.Radius {
		return false
	}
	mid := lerp(a, c, 0.5)
	for _, k := range b.ix.within(mid, d/2+b.p.MinSep, b.pts, nil) {
		if k != skipA && k != skipB && segPointDist(b.pts[k], a, c) < b.p.MinSep+guard {
			return false
		}
	}
	return true
}

// relink recomputes the neighbours of node i.
func (b *builder) relink(i int32) {
	if !b.alive[i] {
		b.adj[i] = nil
		return
	}
	var nbrs []int32
	for _, j := range b.ix.within(b.pts[i], b.p.MaxEdge, b.pts, nil) {
		if j != i && b.linkable(i, j) {
			nbrs = append(nbrs, j)
		}
	}
	b.adj[i] = nbrs
}

func (b *builder) relinkAll() {
	for i := range b.pts {
		b.relink(int32(i))
	}
}

// touched returns the live nodes whose edges may change when nodes appear or
// vanish at the given points: an edge (i, j) can only pass within MinSep of
// q if i is within MaxEdge+MinSep of q.
func (b *builder) touched(at []Point) []int32 {
	var ids []int32
	for _, q := range at {
		ids = b.ix.within(q, b.p.MaxEdge+b.p.MinSep, b.pts, ids)
	}
	slices.Sort(ids)
	return slices.Compact(ids)
}

// passes reports whether a corridor node (exactly two neighbours, not linked
// to each other) lets one blob step in while another steps out the other
// side, so a queue can walk through it. A pocket corner, whose neighbours
// are linked, is no corridor: a blob going past cuts across it.
func (b *builder) passes(v int32) bool {
	n := b.adj[v]
	if len(n) != 2 {
		return true
	}
	if _, linked := slices.BinarySearch(b.adj[n[0]], n[1]); linked {
		return true
	}
	a, c, q := b.pts[n[0]], b.pts[n[1]], b.pts[v]
	return Swept(a, q, q, c) >= b.p.MinSep && Swept(c, q, q, a) >= b.p.MinSep
}

// hops is the number of edges between from and to, or -1 if more than limit.
func (b *builder) hops(from, to int32, limit int) int {
	if from == to {
		return 0
	}
	b.resetSearch()
	b.mark(from, 0)
	b.queue = append(b.queue[:0], from)
	for head := 0; head < len(b.queue); head++ {
		v := b.queue[head]
		d := b.depth[v]
		if int(d) >= limit {
			break
		}
		for _, w := range b.adj[v] {
			if b.seen[w] == b.stamp {
				continue
			}
			if w == to {
				return int(d) + 1
			}
			b.mark(w, d+1)
			b.queue = append(b.queue, w)
		}
	}
	return -1
}

func (b *builder) resetSearch() {
	if len(b.seen) < len(b.pts) {
		b.seen = slices.Grow(b.seen, len(b.pts)-len(b.seen))[:len(b.pts)]
		b.depth = slices.Grow(b.depth, len(b.pts)-len(b.depth))[:len(b.pts)]
	}
	b.stamp++
}

func (b *builder) mark(v int32, d int32) {
	b.seen[v] = b.stamp
	b.depth[v] = d
}

// components counts the connected pieces among live nodes.
func (b *builder) components() int {
	b.resetSearch()
	n := 0
	for s := range b.pts {
		if !b.alive[s] || b.seen[s] == b.stamp {
			continue
		}
		n++
		b.mark(int32(s), 0)
		b.queue = append(b.queue[:0], int32(s))
		for head := 0; head < len(b.queue); head++ {
			for _, w := range b.adj[b.queue[head]] {
				if b.seen[w] != b.stamp {
					b.mark(w, 0)
					b.queue = append(b.queue, w)
				}
			}
		}
	}
	return n
}

// reachable fails if any Stand node is cut off from Stand node 0.
func (b *builder) reachable() error {
	stands := 0
	for _, k := range b.kinds {
		if k == Stand {
			stands++
		}
	}
	if stands == 0 {
		return nil
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
	var cut []int
	for i := 0; i < stands; i++ {
		if b.seen[i] != b.stamp {
			cut = append(cut, i)
		}
	}
	if len(cut) > 0 {
		p := b.pts[cut[0]]
		return fmt.Errorf("nav: %d standing spots are cut off from spot 0, first %d at (%.3f, %.3f)",
			len(cut), cut[0], p.X, p.Z)
	}
	return nil
}

// export renumbers the live nodes (Stand nodes keep their ids) and lists
// every edge once, lower id first, in order.
func (b *builder) export() ([]Point, []Kind, [][2]int) {
	id := make([]int, len(b.pts))
	var pts []Point
	var kinds []Kind
	for i, p := range b.pts {
		id[i] = -1
		if b.alive[i] {
			id[i] = len(pts)
			pts = append(pts, p)
			kinds = append(kinds, b.kinds[i])
		}
	}
	var edges [][2]int
	for i, nbrs := range b.adj {
		for _, j := range nbrs {
			if int(j) > i {
				edges = append(edges, [2]int{id[i], id[j]})
			}
		}
	}
	return pts, kinds, edges
}

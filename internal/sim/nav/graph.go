package nav

import (
	"encoding/binary"
	"fmt"
	"hash/fnv"
	"math"
	"slices"
)

// maxGraphNodes caps the graph so the hop matrix (n*n uint16) stays under
// 128 MiB. The city has about 1,000 nodes.
const maxGraphNodes = 1 << 13

// noPath marks an unreachable pair in the hop matrix. maxGraphNodes keeps
// every real hop count below it.
const noPath = math.MaxUint16

// reachSlack widens the spatial filter in buildConflicts a little, so
// rounding can never drop a pair that Swept would flag.
const reachSlack = 1.001

// boxSlack is the absolute slack CheckGraph allows when it skips a pair by
// bounding boxes, for the same reason. World coordinates are below ~1e3, so
// float error is far smaller.
const boxSlack = 1e-9

// fingerprintScale quantises coordinates to a millionth of a unit before
// hashing, so the fingerprint ignores float noise below that.
const fingerprintScale = 1e6

// Graph is a static walk graph plus the tables the planner reads. Build one
// with FromEdges and do not modify Nodes or Kinds afterwards.
//
// Moves are numbered so the planner can index tables directly: move u < n is
// a stay on node u, and move n+e is the directed edge u -> adj[e], for
// off[u] <= e < off[u+1].
type Graph struct {
	Nodes    []Point
	Kinds    []Kind
	NumStand int

	// Node u's neighbours are adj[off[u]:off[u+1]], ascending.
	off []int32
	adj []int32
	// conf[confOff[m]:confOff[m+1]] lists, ascending, every other move that
	// conflicts with move m.
	confOff []int32
	conf    []int32
	// hops[u*n+v] is the hop count from u to v, or noPath.
	hops []uint16
	core []bool
}

// FromEdges builds a Graph from nodes and undirected edges and precomputes
// everything the planner needs. kinds[i] is node i's Kind; all Stand nodes
// must come first. It rejects bad indices, self-loops, duplicate edges and
// Stand nodes after non-Stand ones, but does not check geometry: CheckGraph
// does. The conflict table is exact for any edge lengths, using p.MinSep.
func FromEdges(nodes []Point, kinds []Kind, edges [][2]int, p Params) (*Graph, error) {
	n := len(nodes)
	if len(kinds) != n {
		return nil, fmt.Errorf("nav: %d kinds for %d nodes", len(kinds), n)
	}
	if n > maxGraphNodes {
		return nil, fmt.Errorf("nav: %d nodes, at most %d", n, maxGraphNodes)
	}
	if !(p.MinSep > 0) {
		return nil, fmt.Errorf("nav: MinSep %v must be positive", p.MinSep)
	}
	numStand := 0
	for i, k := range kinds {
		if k > Bridge {
			return nil, fmt.Errorf("nav: node %d has unknown kind %d", i, k)
		}
		if k == Stand {
			if numStand != i {
				return nil, fmt.Errorf("nav: Stand node %d comes after non-Stand node %d", i, numStand)
			}
			numStand++
		}
	}
	for i, q := range nodes {
		if math.IsNaN(q.X) || math.IsInf(q.X, 0) || math.IsNaN(q.Z) || math.IsInf(q.Z, 0) {
			return nil, fmt.Errorf("nav: node %d has a non-finite position %v", i, q)
		}
	}

	off := make([]int32, n+1)
	for k, e := range edges {
		u, v := e[0], e[1]
		if u < 0 || u >= n || v < 0 || v >= n {
			return nil, fmt.Errorf("nav: edge %d (%d-%d) has a node out of range [0, %d)", k, u, v, n)
		}
		if u == v {
			return nil, fmt.Errorf("nav: edge %d is a self-loop on node %d", k, u)
		}
		off[u+1]++
		off[v+1]++
	}
	for u := range n {
		off[u+1] += off[u]
	}
	adj := make([]int32, off[n])
	fill := slices.Clone(off[:n])
	for _, e := range edges {
		adj[fill[e[0]]] = int32(e[1])
		fill[e[0]]++
		adj[fill[e[1]]] = int32(e[0])
		fill[e[1]]++
	}
	for u := range n {
		nb := adj[off[u]:off[u+1]]
		slices.Sort(nb)
		for k := 1; k < len(nb); k++ {
			if nb[k] == nb[k-1] {
				return nil, fmt.Errorf("nav: duplicate edge %d-%d", u, nb[k])
			}
		}
	}

	g := &Graph{
		Nodes:    slices.Clone(nodes),
		Kinds:    slices.Clone(kinds),
		NumStand: numStand,
		off:      off,
		adj:      adj,
	}
	g.buildConflicts(p.MinSep)
	g.buildHops()
	g.buildCore()
	return g, nil
}

// Swept returns the closest two points get while moving in straight lines,
// a0 -> a1 and b0 -> b1, over the same unit of time. A point that stays put
// has a0 == a1.
func Swept(a0, a1, b0, b1 Point) float64 {
	// The gap between them is w(t) = w0 + t*dv for t in [0, 1]; its length
	// is smallest at the projection of the origin onto that segment.
	//
	// Each product is converted to float64 so the compiler cannot fuse it
	// into a multiply-add: fused results differ between amd64 and arm64,
	// and the conflict table must be the same on every machine.
	w0x, w0z := a0.X-b0.X, a0.Z-b0.Z
	dvx, dvz := (a1.X-a0.X)-(b1.X-b0.X), (a1.Z-a0.Z)-(b1.Z-b0.Z)
	t := 0.0
	if dd := float64(dvx*dvx) + float64(dvz*dvz); dd > 0 {
		t = min(max(-(float64(w0x*dvx)+float64(w0z*dvz))/dd, 0), 1)
	}
	x, z := w0x+float64(t*dvx), w0z+float64(t*dvz)
	return math.Sqrt(float64(x*x) + float64(z*z))
}

// Len returns the number of nodes.
func (g *Graph) Len() int { return len(g.Nodes) }

// Neighbors returns u's neighbours in ascending order, as a copy.
func (g *Graph) Neighbors(u int) []int32 {
	nb := g.adj[g.off[u]:g.off[u+1]]
	if len(nb) == 0 {
		return nil
	}
	return slices.Clone(nb)
}

// Hops returns the fewest edges from u to v, or -1 if v is unreachable.
func (g *Graph) Hops(u, v int) int {
	h := g.hops[u*len(g.Nodes)+v]
	if h == noPath {
		return -1
	}
	return int(h)
}

// Core reports whether u is in the graph's 2-core: what is left after
// repeatedly removing nodes with at most one neighbour. Dead-end spurs are
// outside it; rings and the paths between them are inside.
func (g *Graph) Core(u int) bool { return g.core[u] }

// Conflicts reports whether two simultaneous moves u1 -> v1 and u2 -> v2
// (u == v for a stay) clash: they come closer than Params.MinSep or end on
// the same node. It panics if a move is not a stay or an edge.
func (g *Graph) Conflicts(u1, v1, u2, v2 int) bool {
	m1, m2 := g.move(u1, v1), g.move(u2, v2)
	if m1 < 0 || m2 < 0 {
		panic(fmt.Sprintf("nav: Conflicts(%d, %d, %d, %d): not a stay or an edge", u1, v1, u2, v2))
	}
	if m1 == m2 {
		return true
	}
	_, found := slices.BinarySearch(g.moveConflicts(m1), int32(m2))
	return found
}

// Fingerprint hashes the nodes (quantised to 1e-6), kinds and edges with
// FNV-1a, so callers can tell whether two graphs are the same.
func (g *Graph) Fingerprint() uint64 {
	h := fnv.New64a()
	var buf [8]byte
	put := func(x uint64) {
		binary.LittleEndian.PutUint64(buf[:], x)
		h.Write(buf[:])
	}
	put(uint64(len(g.Nodes)))
	for _, q := range g.Nodes {
		put(uint64(int64(math.Round(q.X * fingerprintScale))))
		put(uint64(int64(math.Round(q.Z * fingerprintScale))))
	}
	for _, k := range g.Kinds {
		put(uint64(k))
	}
	for u := range g.Nodes {
		for _, v := range g.adj[g.off[u]:g.off[u+1]] {
			if int(v) > u {
				put(uint64(u)<<32 | uint64(v))
			}
		}
	}
	return h.Sum64()
}

// numMoves returns how many move ids there are: a stay per node and one per
// directed edge.
func (g *Graph) numMoves() int { return len(g.Nodes) + len(g.adj) }

// move returns the id of the move u -> v, or -1 if v is neither u nor one of
// u's neighbours.
func (g *Graph) move(u, v int) int {
	if u == v {
		return u
	}
	k, found := slices.BinarySearch(g.adj[g.off[u]:g.off[u+1]], int32(v))
	if !found {
		return -1
	}
	return len(g.Nodes) + int(g.off[u]) + k
}

// moveTo returns the node move m ends on.
func (g *Graph) moveTo(m int) int {
	if m < len(g.Nodes) {
		return m
	}
	return int(g.adj[m-len(g.Nodes)])
}

// moveFrom returns the node move m starts on.
func (g *Graph) moveFrom(m int) int {
	if m < len(g.Nodes) {
		return m
	}
	e := int32(m - len(g.Nodes))
	// off is ascending; the start node is the last u with off[u] <= e.
	u, _ := slices.BinarySearch(g.off, e+1)
	return u - 1
}

// moveConflicts returns the moves that conflict with m, ascending.
func (g *Graph) moveConflicts(m int) []int32 { return g.conf[g.confOff[m]:g.confOff[m+1]] }

// clash is the ground truth the conflict table caches.
func (g *Graph) clash(m1, m2 int, minSep float64) bool {
	return g.clashAt(g.moveFrom(m1), g.moveTo(m1), g.moveFrom(m2), g.moveTo(m2), minSep)
}

// clashAt is clash for the moves u1 -> t1 and u2 -> t2.
func (g *Graph) clashAt(u1, t1, u2, t2 int, minSep float64) bool {
	n := g.Nodes
	return t1 == t2 || Swept(n[u1], n[t1], n[u2], n[t2]) < minSep
}

// buildConflicts fills the move-conflict table. Two moves can only clash if
// their start nodes are less than 2*longest + minSep apart (each mover
// covers at most one edge), so nodes are bucketed into cells that wide and
// only neighbouring cells are compared.
func (g *Graph) buildConflicts(minSep float64) {
	n := len(g.Nodes)
	longest := 0.0
	for u := range n {
		for _, v := range g.adj[g.off[u]:g.off[u+1]] {
			a, b := g.Nodes[u], g.Nodes[v]
			longest = max(longest, math.Hypot(a.X-b.X, a.Z-b.Z))
		}
	}
	reach := (2*longest + minSep) * reachSlack

	type cell struct{ x, z int64 }
	cellOf := func(q Point) cell {
		return cell{int64(math.Floor(q.X / reach)), int64(math.Floor(q.Z / reach))}
	}
	buckets := map[cell][]int32{}
	for u, q := range g.Nodes {
		c := cellOf(q)
		buckets[c] = append(buckets[c], int32(u))
	}

	lists := make([][]int32, g.numMoves())
	// movesOf lists the moves starting at u: the stay, then each edge.
	movesOf := func(u int, buf []int32) []int32 {
		buf = append(buf[:0], int32(u))
		for e := g.off[u]; e < g.off[u+1]; e++ {
			buf = append(buf, int32(n)+e)
		}
		return buf
	}
	var mu, mw []int32
	for u := range n {
		cu := cellOf(g.Nodes[u])
		mu = movesOf(u, mu)
		for dx := int64(-1); dx <= 1; dx++ {
			for dz := int64(-1); dz <= 1; dz++ {
				for _, w32 := range buckets[cell{cu.x + dx, cu.z + dz}] {
					w := int(w32)
					a, b := g.Nodes[u], g.Nodes[w]
					if w < u || math.Hypot(a.X-b.X, a.Z-b.Z) >= reach {
						continue
					}
					mw = movesOf(w, mw)
					for _, m1 := range mu {
						for _, m2 := range mw {
							if w == u && m2 <= m1 {
								continue
							}
							if g.clashAt(u, g.moveTo(int(m1)), w, g.moveTo(int(m2)), minSep) {
								lists[m1] = append(lists[m1], m2)
								lists[m2] = append(lists[m2], m1)
							}
						}
					}
				}
			}
		}
	}

	g.confOff = make([]int32, len(lists)+1)
	for m, l := range lists {
		g.confOff[m+1] = g.confOff[m] + int32(len(l))
	}
	g.conf = make([]int32, 0, g.confOff[len(lists)])
	for _, l := range lists {
		slices.Sort(l)
		g.conf = append(g.conf, l...)
	}
}

// buildHops fills the all-pairs hop matrix with a BFS from every node. Hop
// counts are exact shortest-path lengths, so the planner's heuristic never
// misleads it about which neighbour is closer.
func (g *Graph) buildHops() {
	n := len(g.Nodes)
	g.hops = make([]uint16, n*n)
	for i := range g.hops {
		g.hops[i] = noPath
	}
	queue := make([]int32, n)
	for s := range n {
		row := g.hops[s*n : (s+1)*n]
		row[s] = 0
		queue[0] = int32(s)
		for head, tail := 0, 1; head < tail; head++ {
			u := queue[head]
			d := row[u] + 1
			for _, v := range g.adj[g.off[u]:g.off[u+1]] {
				if row[v] == noPath {
					row[v] = d
					queue[tail] = v
					tail++
				}
			}
		}
	}
}

// buildCore marks the 2-core by peeling: drop every node with at most one
// remaining neighbour until none are left.
func (g *Graph) buildCore() {
	n := len(g.Nodes)
	g.core = make([]bool, n)
	deg := make([]int32, n)
	var queue []int32
	for u := range n {
		deg[u] = g.off[u+1] - g.off[u]
		g.core[u] = deg[u] > 1
		if !g.core[u] {
			queue = append(queue, int32(u))
		}
	}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		for _, v := range g.adj[g.off[u]:g.off[u+1]] {
			if g.core[v] {
				deg[v]--
				if deg[v] <= 1 {
					g.core[v] = false
					queue = append(queue, v)
				}
			}
		}
	}
}

// CheckGraph rechecks, by brute force from coordinates, the rules the
// planner relies on, and returns the first one broken:
//
//  1. every two nodes are at least p.MinSep apart;
//  2. every edge passes at least p.MinSep from every node not on it, so a
//     blob standing still is safe from any move;
//  3. every edge is at most p.MaxEdge long;
//  4. at every node v with exactly two neighbours a and b, the moves a -> v
//     and v -> b do not conflict (nor b -> v and v -> a), so a blob dwelling
//     in a corridor can always be pushed on through it;
//  5. the conflict table matches Swept and shared targets for every pair of
//     moves.
func CheckGraph(g *Graph, p Params) error {
	for _, check := range []func(*Graph, Params) error{
		ruleNodeSpacing, ruleEdgeClearance, ruleEdgeLength, rulePassThrough, ruleConflictTable,
	} {
		if err := check(g, p); err != nil {
			return err
		}
	}
	return nil
}

func ruleNodeSpacing(g *Graph, p Params) error {
	for u, a := range g.Nodes {
		for v := u + 1; v < len(g.Nodes); v++ {
			b := g.Nodes[v]
			if d := math.Hypot(a.X-b.X, a.Z-b.Z); d < p.MinSep {
				return fmt.Errorf("nav: nodes %d and %d are %.3f apart, want >= %.3f (MinSep)", u, v, d, p.MinSep)
			}
		}
	}
	return nil
}

func ruleEdgeClearance(g *Graph, p Params) error {
	for u := range g.Nodes {
		for _, v := range g.adj[g.off[u]:g.off[u+1]] {
			if int(v) < u {
				continue
			}
			a, b := g.Nodes[u], g.Nodes[v]
			for w, q := range g.Nodes {
				if w == u || w == int(v) {
					continue
				}
				// Distance from a point to a segment is Swept against a stay.
				if d := Swept(q, q, a, b); d < p.MinSep {
					return fmt.Errorf("nav: edge %d-%d passes %.3f from node %d, want >= %.3f (MinSep)", u, v, d, w, p.MinSep)
				}
			}
		}
	}
	return nil
}

func ruleEdgeLength(g *Graph, p Params) error {
	for u := range g.Nodes {
		for _, v := range g.adj[g.off[u]:g.off[u+1]] {
			a, b := g.Nodes[u], g.Nodes[v]
			if d := math.Hypot(a.X-b.X, a.Z-b.Z); int(v) > u && d > p.MaxEdge {
				return fmt.Errorf("nav: edge %d-%d is %.3f long, want <= %.3f (MaxEdge)", u, v, d, p.MaxEdge)
			}
		}
	}
	return nil
}

func rulePassThrough(g *Graph, p Params) error {
	for v := range g.Nodes {
		nb := g.adj[g.off[v]:g.off[v+1]]
		if len(nb) != 2 {
			continue
		}
		for _, ab := range [][2]int32{{nb[0], nb[1]}, {nb[1], nb[0]}} {
			a, b := ab[0], ab[1]
			q := g.Nodes
			if d := Swept(q[a], q[v], q[v], q[b]); d < p.MinSep {
				return fmt.Errorf("nav: corridor node %d: moves %d->%d and %d->%d come %.3f apart, want >= %.3f (pass-through)",
					v, a, v, v, b, d, p.MinSep)
			}
		}
	}
	return nil
}

// ruleConflictTable compares the table with every pair of moves. Pairs
// whose bounding boxes are clearly more than p.MinSep apart are skipped
// cheaply; the rest go through Swept.
func ruleConflictTable(g *Graph, p Params) error {
	numMoves := g.numMoves()
	if len(g.confOff) != numMoves+1 {
		return fmt.Errorf("nav: conflict table has %d offsets for %d moves", len(g.confOff), numMoves)
	}
	type box struct{ minX, maxX, minZ, maxZ float64 }
	boxes := make([]box, numMoves)
	for m := range boxes {
		a, b := g.Nodes[g.moveFrom(m)], g.Nodes[g.moveTo(m)]
		boxes[m] = box{min(a.X, b.X), max(a.X, b.X), min(a.Z, b.Z), max(a.Z, b.Z)}
	}
	cut := p.MinSep + boxSlack
	for m1 := range numMoves {
		list := g.moveConflicts(m1)
		for k, x := range list {
			switch {
			case x < 0 || int(x) >= numMoves:
				return fmt.Errorf("nav: conflict table for move %s has id %d out of range", g.moveName(m1), x)
			case k > 0 && x <= list[k-1]:
				return fmt.Errorf("nav: conflict table for move %s is not strictly ascending", g.moveName(m1))
			case int(x) == m1 || !g.clash(m1, int(x), p.MinSep):
				return fmt.Errorf("nav: conflict table pairs moves %s and %s, but they do not conflict",
					g.moveName(m1), g.moveName(int(x)))
			}
		}
		b1 := boxes[m1]
		for m2 := range numMoves {
			b2 := boxes[m2]
			if m2 == m1 || b2.minX-b1.maxX >= cut || b1.minX-b2.maxX >= cut ||
				b2.minZ-b1.maxZ >= cut || b1.minZ-b2.maxZ >= cut {
				continue
			}
			if !g.clash(m1, m2, p.MinSep) {
				continue
			}
			if _, found := slices.BinarySearch(list, int32(m2)); !found {
				return fmt.Errorf("nav: conflict table is missing moves %s and %s (swept %.3f, MinSep %.3f)",
					g.moveName(m1), g.moveName(m2), g.sweptOf(m1, m2), p.MinSep)
			}
		}
	}
	return nil
}

// moveName formats move m as "u->v", or "stay u".
func (g *Graph) moveName(m int) string {
	if m < len(g.Nodes) {
		return fmt.Sprintf("stay %d", m)
	}
	return fmt.Sprintf("%d->%d", g.moveFrom(m), g.moveTo(m))
}

func (g *Graph) sweptOf(m1, m2 int) float64 {
	n := g.Nodes
	return Swept(n[g.moveFrom(m1)], n[g.moveTo(m1)], n[g.moveFrom(m2)], n[g.moveTo(m2)])
}

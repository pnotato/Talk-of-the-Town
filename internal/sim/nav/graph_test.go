package nav

import (
	"math"
	"slices"
	"strings"
	"testing"
)

// lattice is the spacing of the city's hex standing grid. Most fixtures use it.
const lattice = 1.8

// hexRise is the distance between rows of that grid, lattice * sqrt(3) / 2.
var hexRise = lattice * math.Sqrt(3) / 2

// linkSlack lets linkWithin join nodes that are a lattice step apart despite
// float rounding.
const linkSlack = 1.01

func pnt(x, z float64) Point { return Point{x, z} }

func allStand(n int) []Kind { return make([]Kind, n) }

func mustGraph(t testing.TB, nodes []Point, kinds []Kind, edges [][2]int) *Graph {
	t.Helper()
	g, err := FromEdges(nodes, kinds, edges, DefaultParams())
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// mustValidGraph is mustGraph plus a CheckGraph pass, for planner fixtures.
func mustValidGraph(t testing.TB, nodes []Point, kinds []Kind, edges [][2]int) *Graph {
	t.Helper()
	g := mustGraph(t, nodes, kinds, edges)
	if err := CheckGraph(g, DefaultParams()); err != nil {
		t.Fatal(err)
	}
	return g
}

// linkWithin joins every pair of nodes at most d apart.
func linkWithin(nodes []Point, d float64) [][2]int {
	var edges [][2]int
	for u := range nodes {
		for v := u + 1; v < len(nodes); v++ {
			if math.Hypot(nodes[u].X-nodes[v].X, nodes[u].Z-nodes[v].Z) <= d {
				edges = append(edges, [2]int{u, v})
			}
		}
	}
	return edges
}

// hexLattice returns a cols x rows hex grid whose first node is at (x0, z0).
// Odd rows are shifted half a step east, or even rows if shiftEven is set.
// Cells where drop returns true are left out.
func hexLattice(cols, rows int, x0, z0 float64, shiftEven bool, drop func(c, r int) bool) []Point {
	var nodes []Point
	for r := range rows {
		for c := range cols {
			if drop != nil && drop(c, r) {
				continue
			}
			x := x0 + float64(c)*lattice
			if (r%2 == 1) != shiftEven {
				x += lattice / 2
			}
			nodes = append(nodes, pnt(x, z0+float64(r)*hexRise))
		}
	}
	return nodes
}

// pruneSharp removes nodes with exactly two neighbours whose pass-through
// moves conflict (a hex grid's 60° corners, say), repeating until none are
// left. Kinds keep their order, so Stand nodes stay first.
func pruneSharp(nodes []Point, kinds []Kind, edges [][2]int) ([]Point, []Kind, [][2]int) {
	minSep := DefaultParams().MinSep
	for {
		nb := make([][]int, len(nodes))
		for _, e := range edges {
			nb[e[0]] = append(nb[e[0]], e[1])
			nb[e[1]] = append(nb[e[1]], e[0])
		}
		drop := -1
		for v, ns := range nb {
			if len(ns) == 2 && Swept(nodes[ns[0]], nodes[v], nodes[v], nodes[ns[1]]) < minSep {
				drop = v
				break
			}
		}
		if drop < 0 {
			return nodes, kinds, edges
		}
		nodes = slices.Delete(slices.Clone(nodes), drop, drop+1)
		kinds = slices.Delete(slices.Clone(kinds), drop, drop+1)
		var kept [][2]int
		for _, e := range edges {
			if e[0] == drop || e[1] == drop {
				continue
			}
			for k := range e {
				if e[k] > drop {
					e[k]--
				}
			}
			kept = append(kept, e)
		}
		edges = kept
	}
}

// flower is a hex cell: node 0 in the middle and nodes 1..6 round it at
// 0°, 60°, ..., 300°, joined to the middle and to each other.
func flower() ([]Point, [][2]int) {
	nodes := []Point{pnt(0, 0)}
	for k := range 6 {
		a := float64(k) * math.Pi / 3
		nodes = append(nodes, pnt(lattice*math.Cos(a), lattice*math.Sin(a)))
	}
	return nodes, linkWithin(nodes, lattice*linkSlack)
}

func TestSwept(t *testing.T) {
	tests := []struct {
		name           string
		a0, a1, b0, b1 Point
		want           float64
	}{
		{"both stay", pnt(0, 0), pnt(0, 0), pnt(3, 4), pnt(3, 4), 5},
		{"parallel", pnt(0, 0), pnt(2, 0), pnt(0, 1.5), pnt(2, 1.5), 1.5},
		{"head-on swap", pnt(0, 0), pnt(lattice, 0), pnt(lattice, 0), pnt(0, 0), 0},
		{"straight follow", pnt(0, 0), pnt(lattice, 0), pnt(lattice, 0), pnt(2*lattice, 0), lattice},
		{"follow with 60° turn", pnt(0, 0), pnt(lattice, 0), pnt(lattice, 0), pnt(1.5*lattice, hexRise), hexRise},
		{"follow with 120° turn", pnt(0, 0), pnt(lattice, 0), pnt(lattice, 0), pnt(lattice/2, hexRise), lattice / 2},
		{"crossing paths", pnt(0, 0), pnt(2, 0), pnt(1, -1), pnt(1, 1), 0},
		{"identical points", pnt(1, 1), pnt(1, 1), pnt(1, 1), pnt(1, 1), 0},
		{"closest at the end", pnt(0, 0), pnt(1, 0), pnt(3, 0), pnt(2.5, 0), 1.5},
		{"closest at the start", pnt(0, 0), pnt(-1, 0), pnt(1, 0), pnt(2, 0), 1},
		{"standing beside a passing move", pnt(0, 1), pnt(0, 1), pnt(-1, 0), pnt(1, 0), 1},
		{"standing past the end of a move", pnt(3, 4), pnt(3, 4), pnt(-1, 0), pnt(0, 0), 5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Swept(tt.a0, tt.a1, tt.b0, tt.b1)
			if math.Abs(got-tt.want) > 1e-9 {
				t.Errorf("Swept = %.12f, want %.12f", got, tt.want)
			}
			if back := Swept(tt.b0, tt.b1, tt.a0, tt.a1); back != got {
				t.Errorf("Swept is not symmetric: %v vs %v", got, back)
			}
		})
	}
}

func TestFromEdgesErrors(t *testing.T) {
	line := []Point{pnt(0, 0), pnt(lattice, 0), pnt(2*lattice, 0)}
	def := DefaultParams()
	tests := []struct {
		name  string
		nodes []Point
		kinds []Kind
		edges [][2]int
		p     Params
		want  string
	}{
		{"kinds length", line, allStand(2), nil, def, "2 kinds for 3 nodes"},
		{"index too big", line, allStand(3), [][2]int{{0, 3}}, def, "out of range"},
		{"negative index", line, allStand(3), [][2]int{{-1, 0}}, def, "out of range"},
		{"self-loop", line, allStand(3), [][2]int{{1, 1}}, def, "self-loop on node 1"},
		{"duplicate", line, allStand(3), [][2]int{{0, 1}, {0, 1}}, def, "duplicate edge 0-1"},
		{"duplicate reversed", line, allStand(3), [][2]int{{0, 1}, {1, 0}}, def, "duplicate edge 0-1"},
		{"Stand after Fill", line, []Kind{Stand, Fill, Stand}, nil, def, "Stand node 2 comes after"},
		{"unknown kind", line, []Kind{Stand, Kind(7), Fill}, nil, def, "unknown kind 7"},
		{"MinSep zero", line, allStand(3), nil, Params{}, "MinSep"},
		{"NaN position", []Point{pnt(0, 0), pnt(math.NaN(), 0)}, allStand(2), nil, def, "node 1"},
		{"infinite position", []Point{pnt(math.Inf(1), 0)}, allStand(1), nil, def, "node 0"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := FromEdges(tt.nodes, tt.kinds, tt.edges, tt.p)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("err = %v, want it to mention %q", err, tt.want)
			}
		})
	}
}

func TestFromEdgesCopiesInput(t *testing.T) {
	nodes := []Point{pnt(0, 0), pnt(lattice, 0)}
	kinds := []Kind{Stand, Fill}
	g := mustGraph(t, nodes, kinds, [][2]int{{0, 1}})
	nodes[0].X, kinds[1] = 99, Bridge
	if g.Nodes[0].X != 0 || g.Kinds[1] != Fill {
		t.Fatal("graph shares the caller's slices")
	}
	if g.Len() != 2 || g.NumStand != 1 {
		t.Fatalf("Len %d NumStand %d, want 2 and 1", g.Len(), g.NumStand)
	}
}

// lollipop is a square ring 0-1-2-3 with a spur 3-4-5 and a lone node 6.
func lollipop(t *testing.T) *Graph {
	nodes := []Point{pnt(0, 0), pnt(lattice, 0), pnt(lattice, lattice), pnt(0, lattice),
		pnt(0, 2*lattice), pnt(0, 3*lattice), pnt(20, 20)}
	edges := [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}, {4, 3}, {4, 5}}
	return mustGraph(t, nodes, allStand(len(nodes)), edges)
}

func TestNeighbors(t *testing.T) {
	g := lollipop(t)
	tests := []struct {
		u    int
		want []int32
	}{
		{0, []int32{1, 3}},
		{3, []int32{0, 2, 4}},
		{4, []int32{3, 5}},
		{6, nil},
	}
	for _, tt := range tests {
		if got := g.Neighbors(tt.u); !slices.Equal(got, tt.want) {
			t.Errorf("Neighbors(%d) = %v, want %v", tt.u, got, tt.want)
		}
	}
	g.Neighbors(3)[0] = 5
	if got := g.Neighbors(3); got[0] != 0 {
		t.Error("changing the returned slice changed the graph")
	}
}

func TestHops(t *testing.T) {
	g := lollipop(t)
	tests := []struct{ u, v, want int }{
		{0, 0, 0},
		{0, 1, 1},
		{0, 2, 2},
		{0, 5, 3},
		{1, 5, 4},
		{5, 1, 4},
		{2, 4, 2},
		{0, 6, -1},
		{6, 0, -1},
		{6, 6, 0},
	}
	for _, tt := range tests {
		if got := g.Hops(tt.u, tt.v); got != tt.want {
			t.Errorf("Hops(%d, %d) = %d, want %d", tt.u, tt.v, got, tt.want)
		}
	}
}

func TestCore(t *testing.T) {
	// Positions do not matter for the 2-core; put nodes on a line.
	line := func(n int) []Point {
		nodes := make([]Point, n)
		for i := range nodes {
			nodes[i] = pnt(float64(i)*lattice, 0)
		}
		return nodes
	}
	tests := []struct {
		name  string
		n     int
		edges [][2]int
		want  []bool
	}{
		{"ring", 4, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}}, []bool{true, true, true, true}},
		{"ring with a spur", 6, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}, {3, 4}, {4, 5}},
			[]bool{true, true, true, true, false, false}},
		{"path", 3, [][2]int{{0, 1}, {1, 2}}, []bool{false, false, false}},
		{"star", 4, [][2]int{{0, 1}, {0, 2}, {0, 3}}, []bool{false, false, false, false}},
		{"lone node", 1, nil, []bool{false}},
		// A path between two cycles stays: every node on it keeps degree 2.
		{"two triangles joined by a path", 7,
			[][2]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 6}, {6, 4}},
			[]bool{true, true, true, true, true, true, true}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := mustGraph(t, line(tt.n), allStand(tt.n), tt.edges)
			for u, want := range tt.want {
				if got := g.Core(u); got != want {
					t.Errorf("Core(%d) = %v, want %v", u, got, want)
				}
			}
		})
	}
}

func TestFingerprint(t *testing.T) {
	nodes, edges := flower()
	kinds := allStand(len(nodes))
	base := mustGraph(t, nodes, kinds, edges).Fingerprint()

	flipped := slices.Clone(edges)
	slices.Reverse(flipped)
	for i := range flipped {
		flipped[i] = [2]int{flipped[i][1], flipped[i][0]}
	}
	if got := mustGraph(t, nodes, kinds, flipped).Fingerprint(); got != base {
		t.Error("edge order or direction changed the fingerprint")
	}
	jitter := slices.Clone(nodes)
	jitter[2].X += 1e-9
	if got := mustGraph(t, jitter, kinds, edges).Fingerprint(); got != base {
		t.Error("a 1e-9 nudge changed the fingerprint")
	}

	moved := slices.Clone(nodes)
	moved[2].Z += 1e-5
	lastFill := slices.Clone(kinds)
	lastFill[6] = Fill
	changes := []struct {
		name  string
		nodes []Point
		kinds []Kind
		edges [][2]int
	}{
		{"node moved", moved, kinds, edges},
		{"kind changed", nodes, lastFill, edges},
		{"edge dropped", nodes, kinds, edges[1:]},
		{"node added", append(slices.Clone(nodes), pnt(9, 9)), allStand(len(nodes) + 1), edges},
	}
	for _, c := range changes {
		if got := mustGraph(t, c.nodes, c.kinds, c.edges).Fingerprint(); got == base {
			t.Errorf("%s: fingerprint unchanged", c.name)
		}
	}
}

func TestConflicts(t *testing.T) {
	nodes, edges := flower()
	g := mustValidGraph(t, nodes, allStand(len(nodes)), edges)
	// In the flower, node 0 is the middle and k = 1..6 sits at (k-1)*60°.
	tests := []struct {
		name           string
		u1, v1, u2, v2 int
		want           bool
	}{
		{"swap", 0, 1, 1, 0, true},
		{"same target", 1, 0, 2, 0, true},
		{"same start", 0, 1, 0, 2, true},
		{"straight follow", 4, 0, 0, 1, false},
		{"follow with 60° turn", 4, 0, 0, 2, false},
		{"follow with 120° turn", 4, 0, 0, 3, true},
		{"3-cycle round a triangle", 0, 1, 1, 2, true},
		{"parallel", 3, 2, 0, 1, false},
		{"both stay", 1, 1, 2, 2, false},
		{"stay beside a passing move", 2, 2, 0, 1, false},
		{"stay on the target", 1, 1, 0, 1, true},
		{"same move", 0, 1, 0, 1, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := g.Conflicts(tt.u1, tt.v1, tt.u2, tt.v2); got != tt.want {
				t.Errorf("Conflicts = %v, want %v", got, tt.want)
			}
			if got := g.Conflicts(tt.u2, tt.v2, tt.u1, tt.v1); got != tt.want {
				t.Errorf("reversed Conflicts = %v, want %v", got, tt.want)
			}
		})
	}
	defer func() {
		if recover() == nil {
			t.Error("Conflicts on a non-edge did not panic")
		}
	}()
	g.Conflicts(1, 4, 0, 0)
}

// The table must be exact even when an edge is longer than Params.MaxEdge,
// since FromEdges does not enforce geometry.
func TestConflictTableWithLongEdge(t *testing.T) {
	nodes := []Point{pnt(0, 0), pnt(20, 0), pnt(10, 0.5), pnt(10, 0.5+lattice)}
	g := mustGraph(t, nodes, allStand(4), [][2]int{{0, 1}, {2, 3}})
	if !g.Conflicts(0, 1, 2, 2) {
		t.Error("standing 0.5 from the middle of a long move is not a conflict")
	}
	if err := checkConflictTable(g, DefaultParams()); err != nil {
		t.Error(err)
	}
}

// withoutConflict drops the first entry from move m's conflict list.
func withoutConflict(g *Graph, m int) {
	at := g.confOff[m]
	g.conf = slices.Delete(g.conf, int(at), int(at)+1)
	for k := m + 1; k < len(g.confOff); k++ {
		g.confOff[k]--
	}
}

// withConflict adds x to move m's conflict list, keeping it sorted.
func withConflict(g *Graph, m, x int) {
	list := g.conf[g.confOff[m]:g.confOff[m+1]]
	k, _ := slices.BinarySearch(list, int32(x))
	g.conf = slices.Insert(g.conf, int(g.confOff[m])+k, int32(x))
	for j := m + 1; j < len(g.confOff); j++ {
		g.confOff[j]++
	}
}

func TestCheckGraphCatches(t *testing.T) {
	type graphFunc func(t *testing.T) *Graph
	line := func(step float64, n int) []Point {
		nodes := make([]Point, n)
		for i := range nodes {
			nodes[i] = pnt(float64(i)*step, 0)
		}
		return nodes
	}
	path := func(n int) [][2]int {
		var e [][2]int
		for i := 1; i < n; i++ {
			e = append(e, [2]int{i - 1, i})
		}
		return e
	}
	tests := []struct {
		name  string
		graph graphFunc
		want  []string
	}{
		{"nodes too close", func(t *testing.T) *Graph {
			nodes := line(1.4, 3)
			nodes[1].X -= 0.3
			return mustGraph(t, nodes, allStand(3), path(3))
		}, []string{"nodes 0 and 1", "1.100", "MinSep"}},
		{"edge too close to a node", func(t *testing.T) *Graph {
			nodes := append(line(lattice, 2), pnt(lattice/2, 1))
			return mustGraph(t, nodes, allStand(3), path(2))
		}, []string{"edge 0-1", "node 2", "1.000"}},
		{"edge too long", func(t *testing.T) *Graph {
			return mustGraph(t, line(2, 3), allStand(3), path(3))
		}, []string{"edge 0-1", "2.000", "MaxEdge"}},
		{"too-sharp corridor turn", func(t *testing.T) *Graph {
			nodes := []Point{pnt(-lattice, 0), pnt(0, 0), pnt(-lattice/2, hexRise)}
			return mustGraph(t, nodes, allStand(3), path(3))
		}, []string{"node 1", "0->1", "1->2", "0.900"}},
		{"dropped conflict entry", func(t *testing.T) *Graph {
			nodes, edges := flower()
			g := mustGraph(t, nodes, allStand(len(nodes)), edges)
			withoutConflict(g, g.move(1, 0))
			return g
		}, []string{"conflict table", "missing"}},
		{"extra conflict entry", func(t *testing.T) *Graph {
			nodes, edges := flower()
			g := mustGraph(t, nodes, allStand(len(nodes)), edges)
			withConflict(g, g.move(4, 0), g.move(0, 1))
			return g
		}, []string{"conflict table", "4->0", "0->1"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := CheckGraph(tt.graph(t), DefaultParams())
			if err == nil {
				t.Fatal("CheckGraph passed")
			}
			for _, w := range tt.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q does not mention %q", err, w)
				}
			}
		})
	}
}

func TestCheckGraphPasses(t *testing.T) {
	nodes, edges := flower()
	if err := CheckGraph(mustGraph(t, nodes, allStand(len(nodes)), edges), DefaultParams()); err != nil {
		t.Errorf("flower: %v", err)
	}
	for _, fx := range plannerFixtures() {
		g := mustGraph(t, fx.nodes, fx.kinds, fx.edges)
		if err := CheckGraph(g, DefaultParams()); err != nil {
			t.Errorf("%s: %v", fx.name, err)
		}
	}
}

// navFixture is a small walk graph for planner tests. Every one passes
// CheckGraph. Agent counts are 30-40% of the goal nodes, three or four times
// the city's density (100 blobs on ~1,000 nodes), so agents meet often.
type navFixture struct {
	name   string
	nodes  []Point
	kinds  []Kind
	edges  [][2]int
	agents int
}

func plannerFixtures() []navFixture {
	return []navFixture{hexHolesFixture(), ringFixture(), roomsFixture(), blocksFixture(), spursFixture()}
}

// fixtureLink is the join distance for fixtures: a lattice step plus slack.
// Corridor and crosswalk steps (1.75) are just under it.
const fixtureLink = lattice * linkSlack

// corridorStep is the node spacing along 1-wide corridors and crosswalks,
// like Params.ChainStep.
const corridorStep = 1.75

// hexHolesFixture is an open plaza: a hex grid with two round holes.
func hexHolesFixture() navFixture {
	holes := []Point{pnt(7, 6), pnt(17, 11)}
	const holeRadius = 2.5
	drop := func(c, r int) bool {
		q := pnt(float64(c)*lattice, float64(r)*hexRise)
		if r%2 == 1 {
			q.X += lattice / 2
		}
		for _, h := range holes {
			if math.Hypot(q.X-h.X, q.Z-h.Z) < holeRadius {
				return true
			}
		}
		return false
	}
	nodes := hexLattice(14, 12, 0, 0, false, drop)
	nodes, kinds, edges := pruneSharp(nodes, allStand(len(nodes)), linkWithin(nodes, fixtureLink))
	return navFixture{"hex with holes", nodes, kinds, edges, 45}
}

// ringFixture is a 1-wide loop, where nobody can overtake.
func ringFixture() navFixture {
	const n = 24
	r := corridorStep / (2 * math.Sin(math.Pi/n))
	nodes := make([]Point, n)
	edges := make([][2]int, n)
	for i := range nodes {
		a := 2 * math.Pi * float64(i) / n
		nodes[i] = pnt(r*math.Cos(a), r*math.Sin(a))
		edges[i] = [2]int{i, (i + 1) % n}
	}
	return navFixture{"1-wide ring", nodes, allStand(n), edges, 9}
}

// roomsFixture is two hex rooms joined by a straight 1-wide corridor whose
// nodes are standing spots too, so blobs may stop in it.
func roomsFixture() navFixture {
	const corridor = 4
	mid := 3 * hexRise // the rooms' middle row, which the corridor leaves from
	nodes := hexLattice(5, 7, 0, 0, false, nil)
	door := 4*lattice + lattice/2 // the east end of the left room's middle row
	for k := 1; k <= corridor; k++ {
		nodes = append(nodes, pnt(door+float64(k)*corridorStep, mid))
	}
	// Flip the shifted rows so the right room's middle row reaches west.
	nodes = append(nodes, hexLattice(5, 7, door+(corridor+1)*corridorStep, 0, true, nil)...)
	nodes, kinds, edges := pruneSharp(nodes, allStand(len(nodes)), linkWithin(nodes, fixtureLink))
	return navFixture{"two rooms and a corridor", nodes, kinds, edges, 21}
}

// blocksFixture is two 1-wide sidewalk rings round city blocks, joined by two
// crosswalk chains across the road between them.
func blocksFixture() navFixture {
	const w, h = 6, 4 // block size in lattice steps
	ring := func(x0 float64) []Point {
		var nodes []Point
		for i := range w {
			nodes = append(nodes, pnt(x0+float64(i)*lattice, 0))
		}
		for j := range h {
			nodes = append(nodes, pnt(x0+w*lattice, float64(j)*lattice))
		}
		for i := w; i > 0; i-- {
			nodes = append(nodes, pnt(x0+float64(i)*lattice, h*lattice))
		}
		for j := h; j > 0; j-- {
			nodes = append(nodes, pnt(x0, float64(j)*lattice))
		}
		return nodes
	}
	east := w * lattice
	const chain = 2 // crosswalk nodes per crossing
	nodes := append(ring(0), ring(east+(chain+1)*corridorStep)...)
	stand := len(nodes)
	for _, z := range []float64{lattice, (h - 1) * lattice} {
		for k := 1; k <= chain; k++ {
			nodes = append(nodes, pnt(east+float64(k)*corridorStep, z))
		}
	}
	kinds := allStand(len(nodes))
	for i := stand; i < len(kinds); i++ {
		kinds[i] = Crossing
	}
	return navFixture{"sidewalk rings and crosswalks", nodes, kinds, linkWithin(nodes, fixtureLink), 12}
}

// spursFixture is a ring with three dead-end spurs of standing spots. Spur
// nodes are not in the 2-core, so they are never goals.
func spursFixture() navFixture {
	const n, spurs, spurLen = 30, 3, 3
	r := lattice / (2 * math.Sin(math.Pi/n))
	var nodes []Point
	var edges [][2]int
	for i := range n {
		a := 2 * math.Pi * float64(i) / n
		nodes = append(nodes, pnt(r*math.Cos(a), r*math.Sin(a)))
		edges = append(edges, [2]int{i, (i + 1) % n})
	}
	for s := range spurs {
		base := s * n / spurs
		a := 2 * math.Pi * float64(base) / n
		prev := base
		for k := 1; k <= spurLen; k++ {
			d := r + float64(k)*lattice
			nodes = append(nodes, pnt(d*math.Cos(a), d*math.Sin(a)))
			edges = append(edges, [2]int{prev, len(nodes) - 1})
			prev = len(nodes) - 1
		}
	}
	return navFixture{"ring with dead-end spurs", nodes, allStand(len(nodes)), edges, 9}
}

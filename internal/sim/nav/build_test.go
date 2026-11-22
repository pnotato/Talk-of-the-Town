package nav

import (
	"math"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// spotReach is BLOB_REACH in web/src/scene/mapLayout.ts: standing spots keep
// this far from obstacles.
const spotReach = 0.85

// spotsOn lays standing spots the way the scene does: the hex grid through
// anchor, a radius in from the rect's edges and spotReach clear of obstacles,
// row by row.
func spotsOn(r Rect, anchor Point, obs obstacles) []Point {
	row := lattice * math.Sqrt(3) / 2
	var spots []Point
	for k := -40; k <= 40; k++ {
		shift := float64(k&1) * lattice / 2
		for c := -40; c <= 40; c++ {
			p := Point{anchor.X + float64(c)*lattice + shift, anchor.Z + float64(k)*row}
			edge := min(p.X-r.MinX, r.MaxX-p.X, p.Z-r.MinZ, r.MaxZ-p.Z)
			if edge >= 0.6-1e-9 && obs.dist(p) >= spotReach {
				spots = append(spots, p)
			}
		}
	}
	return spots
}

// area makes an area with scene-style spots.
func area(name string, r Rect, anchor Point, m *Map) Area {
	return Area{Name: name, Rect: r, Spots: spotsOn(r, anchor, obstacles{discs: m.Discs, boxes: m.Boxes})}
}

func mustBuild(t testing.TB, m Map) *Graph {
	t.Helper()
	g, err := Build(m, DefaultParams())
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func kindCount(g *Graph, k Kind) int {
	n := 0
	for _, x := range g.Kinds {
		if x == k {
			n++
		}
	}
	return n
}

// A plain rect is exactly its hex grid: every spot a Stand node, an edge
// between every two spots a spacing apart and no others, nothing added. The
// rect has short rows top and bottom so no corner is a sharp turn.
func TestBuildOneRectIsHexGrid(t *testing.T) {
	row := lattice * math.Sqrt(3) / 2
	r := Rect{MinX: 0, MaxX: 8.4, MinZ: 0, MaxZ: 1.2 + 2*row}
	m := Map{Spacing: lattice}
	m.Areas = []Area{area("square", r, Point{1.5, 0.6}, &m)}
	if n := len(m.Areas[0].Spots); n != 13 {
		t.Fatalf("fixture has %d spots, want 13", n)
	}
	g := mustBuild(t, m)
	if g.Len() != 13 || g.NumStand != 13 {
		t.Fatalf("graph has %d nodes (%d Stand), want 13 Stand only", g.Len(), g.NumStand)
	}
	edges := 0
	for u := range g.Len() {
		var want []int32
		for v := range g.Len() {
			if v != u && math.Abs(dist(g.Nodes[u], g.Nodes[v])-lattice) < 1e-9 {
				want = append(want, int32(v))
			}
		}
		if got := g.Neighbors(u); !slices.Equal(got, want) {
			t.Errorf("node %d neighbours %v, want %v", u, got, want)
		}
		edges += len(want)
	}
	if edges/2 != 26 {
		t.Errorf("%d edges, want 26", edges/2)
	}
}

// A two-row strip has a 60 degree pocket at each end of its first row:
// two neighbours joined to each other. Pockets are no corridor, so Build
// keeps every hex edge; they just aren't goals.
func TestBuildKeepsPocketCorners(t *testing.T) {
	row := lattice * math.Sqrt(3) / 2
	m := Map{Spacing: lattice}
	m.Areas = []Area{area("strip", Rect{MinX: 0, MaxX: 6.6, MinZ: 0, MaxZ: 1.2 + row}, Point{0.6, 0.6}, &m)}
	g := mustBuild(t, m)
	if g.Len() != 7 {
		t.Fatalf("%d nodes, want the 7 spots", g.Len())
	}
	pockets := 0
	for u := range g.Len() {
		nb := g.Neighbors(u)
		for v := range g.Len() {
			linked := slices.Contains(nb, int32(v))
			if spaced := v != u && math.Abs(dist(g.Nodes[u], g.Nodes[v])-lattice) < 1e-9; linked != spaced {
				t.Errorf("edge %d-%d present %v, want %v", u, v, linked, spaced)
			}
		}
		if len(nb) == 2 && slices.Contains(g.Neighbors(int(nb[0])), nb[1]) {
			pockets++
			if g.GoalOK(u) {
				t.Errorf("pocket %d at %v is a goal", u, g.Nodes[u])
			}
		}
	}
	if pockets != 2 {
		t.Errorf("%d pockets, want 2", pockets)
	}
}

// crosswalkMap is two sidewalks either side of a 7-wide road with one zebra
// crossing between them.
func crosswalkMap() Map {
	m := Map{Spacing: lattice}
	m.Areas = []Area{
		area("north", Rect{MinX: 0, MaxX: 12, MinZ: 0, MaxZ: 2.5}, Point{0.6, 1.25}, &m),
		area("south", Rect{MinX: 0, MaxX: 12, MinZ: 9.5, MaxZ: 12}, Point{0.6, 10.75}, &m),
	}
	m.Crosswalks = []Crosswalk{{Rect: Rect{MinX: 4.8, MaxX: 7.2, MinZ: 2.5, MaxZ: 9.5}, Axis: AxisZ}}
	return m
}

func TestBuildCrosswalkChain(t *testing.T) {
	m := crosswalkMap()
	g := mustBuild(t, m)
	if n := kindCount(g, Crossing); n < 3 {
		t.Fatalf("%d Crossing nodes, want a chain of at least 3", n)
	}
	for u, p := range g.Nodes {
		if p.Z > 2.5 && p.Z < 9.5 {
			if g.Kinds[u] != Crossing {
				t.Errorf("node %d on the road is %s, want crossing", u, kindName(g.Kinds[u]))
			}
			// The kerb points' nearest spots are straight across, so the
			// chain runs down the centreline.
			if math.Abs(p.X-6) > 1e-6 {
				t.Errorf("crossing node %d at %v is off the centreline x=6", u, p)
			}
		}
	}
	if h := g.Hops(0, g.NumStand-1); h < 0 {
		t.Error("the two sidewalks are not connected")
	}
}

// Without its crosswalk the same road splits the map, and Build says so.
func TestBuildRoadWithoutCrosswalkFails(t *testing.T) {
	m := crosswalkMap()
	m.Crosswalks = nil
	_, err := Build(m, DefaultParams())
	if err == nil || !strings.Contains(err.Error(), "cut off") {
		t.Fatalf("err = %v, want standing spots cut off", err)
	}
}

// A doorstep (not an obstacle for walking) left a hole in a sidewalk's
// spots; grid fill puts a node back on the grid there.
func TestBuildFillsDoorwayGap(t *testing.T) {
	r := Rect{MinX: 0, MaxX: 12.6, MinZ: 0, MaxZ: 2.5}
	m := Map{Spacing: lattice}
	a := area("sidewalk", r, Point{0.9, 1.25}, &m)
	door := Point{0.9 + 3*lattice, 1.25}
	a.Spots = slices.DeleteFunc(a.Spots, func(p Point) bool { return dist(p, door) < 1e-9 })
	m.Areas = []Area{a}
	g := mustBuild(t, m)
	if n := kindCount(g, Fill); n != 1 {
		t.Fatalf("%d Fill nodes, want 1", n)
	}
	for u, k := range g.Kinds {
		if k == Fill && dist(g.Nodes[u], door) > 1e-6 {
			t.Errorf("fill node at %v, want %v", g.Nodes[u], door)
		}
	}
	for u := range g.Len() {
		if g.Hops(0, u) < 0 {
			t.Errorf("node %d is cut off", u)
		}
	}
}

// cornerMap copies the city's tightest corner: block [1,-1]'s north and east
// sidewalks, the building between them and the lamp in the corner.
func cornerMap() Map {
	m := Map{
		Spacing: lattice,
		Discs:   []Disc{{X: 53.2, Z: -36.2, R: 0.3}, {X: 30.8, Z: -36.2, R: 0.3}},
		Boxes:   []Rect{{MinX: 42.5, MaxX: 51.5, MinZ: -34.5, MaxZ: -21.5}},
	}
	// Anchors as layoutCity.sidewalkStrips: centred between the kerb's
	// radius and the wall's reach, the east strip zigzagging about it.
	fromKerb := (0.6 + 2.5 - spotReach) / 2
	m.Areas = []Area{
		area("north", Rect{MinX: 30, MaxX: 54, MinZ: -37, MaxZ: -34.5}, Point{42, -37 + fromKerb}, &m),
		area("east", Rect{MinX: 51.5, MaxX: 54, MinZ: -34.5, MaxZ: -21.5}, Point{54 - fromKerb - lattice/4, -28}, &m),
	}
	return m
}

func TestBuildBridgesCorner(t *testing.T) {
	m := cornerMap()
	g := mustBuild(t, m)
	if n := kindCount(g, Bridge); n == 0 {
		t.Fatal("no Bridge nodes round the corner")
	}
	// The ends of the two strips nearest the corner are a short walk apart.
	north, east := m.Areas[0].Spots, m.Areas[1].Spots
	a := slices.IndexFunc(north, func(p Point) bool {
		return !slices.ContainsFunc(north, func(q Point) bool { return q.X > p.X })
	})
	b := len(north) + slices.IndexFunc(east, func(p Point) bool {
		return !slices.ContainsFunc(east, func(q Point) bool { return q.Z < p.Z })
	})
	if h := g.Hops(a, b); h < 0 || h > 4 {
		t.Errorf("corner ends %d %v and %d %v are %d hops apart, want 1..4", a, g.Nodes[a], b, g.Nodes[b], h)
	}
}

// Two sidewalks split by a wall with no way round: Build must fail, never
// drop the cut-off spots.
func TestBuildWalledOffGapFails(t *testing.T) {
	m := Map{Spacing: lattice, Boxes: []Rect{{MinX: 5.5, MaxX: 6.5, MinZ: -1, MaxZ: 4}}}
	m.Areas = []Area{
		area("west", Rect{MinX: 0, MaxX: 6, MinZ: 0, MaxZ: 2.5}, Point{0.6, 1.25}, &m),
		area("east", Rect{MinX: 6, MaxX: 12, MinZ: 0, MaxZ: 2.5}, Point{7.2, 1.25}, &m),
	}
	if _, err := Build(m, DefaultParams()); err == nil || !strings.Contains(err.Error(), "cut off") {
		t.Fatalf("err = %v, want standing spots cut off", err)
	}
}

// A node whose only two edges turn too sharply for a queue to pass becomes
// a dead end rather than breaking the pass-through rule. The fixture is the
// park's south-east corner: a sidewalk row and a lawn row on different grids,
// 1.515 apart, so every corner of the ladder turns 90 degrees with a swept
// gap of 1.176, under MinSep. Each cut leaves the corner and the node it was
// cut from as dead ends, so the ladder ends up an H.
func TestBuildTrimsSharpCorners(t *testing.T) {
	m := Map{Spacing: lattice}
	m.Areas = []Area{
		{Name: "sidewalk", Rect: Rect{MinX: -0.6, MaxX: 4.2, MinZ: -0.6, MaxZ: 0.6},
			Spots: []Point{{0, 0}, {1.8, 0}, {3.6, 0}}},
		{Name: "lawn", Rect: Rect{MinX: -0.6, MaxX: 4.2, MinZ: -2.115, MaxZ: -0.6},
			Spots: []Point{{0, -1.515}, {1.8, -1.515}, {3.6, -1.515}}},
	}
	g := mustBuild(t, m)
	deadEnds := 0
	for v := range g.Len() {
		nb := g.Neighbors(v)
		if len(nb) == 1 {
			deadEnds++
		}
		if len(nb) == 2 {
			if s := Swept(g.Nodes[nb[0]], g.Nodes[v], g.Nodes[v], g.Nodes[nb[1]]); s < DefaultParams().MinSep {
				t.Errorf("node %d keeps a sharp corridor (swept %.3f)", v, s)
			}
		}
		if g.Hops(0, v) < 0 {
			t.Errorf("node %d cut off", v)
		}
	}
	if deadEnds != 4 {
		t.Errorf("%d dead ends, want 4 (an H)", deadEnds)
	}
}

func TestBuildDeterministic(t *testing.T) {
	for name, m := range map[string]Map{"crosswalk": crosswalkMap(), "corner": cornerMap()} {
		g1, g2 := mustBuild(t, m), mustBuild(t, m)
		if g1.Fingerprint() != g2.Fingerprint() {
			t.Errorf("%s: fingerprints differ", name)
		}
		if !reflect.DeepEqual(g1, g2) {
			t.Errorf("%s: graphs differ", name)
		}
	}
}

func TestBuildRejectsBadInput(t *testing.T) {
	good := crosswalkMap()
	p := DefaultParams()
	tests := []struct {
		name string
		m    Map
		p    Params
	}{
		{"no areas", Map{Spacing: lattice}, p},
		{"empty rect", Map{Spacing: lattice, Areas: []Area{{Rect: Rect{MinX: 1, MaxX: 1, MinZ: 0, MaxZ: 1}}}}, p},
		{"bad spacing", Map{Spacing: 3, Areas: good.Areas}, p},
		{"zero radius", good, Params{MinSep: 1.2, FillGap: 1.4, BridgeGap: 1.25, MaxEdge: 1.95, ChainStep: 1.75, Grid: 0.1}},
		{"step past max edge", good, Params{Radius: 0.6, MinSep: 1.2, FillGap: 1.4, BridgeGap: 1.25, MaxEdge: 1.95, ChainStep: 2, Grid: 0.1}},
		{"bad axis", Map{Spacing: lattice, Areas: good.Areas, Crosswalks: []Crosswalk{{Rect: good.Crosswalks[0].Rect, Axis: 7}}}, p},
	}
	for _, tc := range tests {
		if _, err := Build(tc.m, tc.p); err == nil {
			t.Errorf("%s: Build succeeded, want an error", tc.name)
		}
	}
}

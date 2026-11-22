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

// The edge rule on its own: two nodes link only if the step is short, stays
// on walkable ground, keeps Radius from obstacles and MinSep from any
// bystander.
func TestEdgeRule(t *testing.T) {
	ground := Area{Name: "l", Rect: Rect{MinX: -5, MaxX: 5, MinZ: -5, MaxZ: 1}}
	leg := Area{Name: "leg", Rect: Rect{MinX: -5, MaxX: -1, MinZ: 1, MaxZ: 5}}
	tests := []struct {
		name      string
		a, b      Point
		bystander *Point
		disc      *Disc
		want      bool
	}{
		{"open ground", Point{0, 0}, Point{1.8, 0}, nil, nil, true},
		{"too long", Point{0, 0}, Point{2, 0}, nil, nil, false},
		{"bystander 1.1 off", Point{0, 0}, Point{1.8, 0}, &Point{0.9, 1.1}, nil, false},
		{"bystander 1.25 off", Point{0, 0}, Point{1.8, 0}, &Point{0.9, -1.25}, nil, true},
		{"lamp 0.5 off", Point{0, 0}, Point{1.8, 0}, nil, &Disc{X: 0.9, Z: 0.8, R: 0.3}, false},
		{"lamp 0.65 off", Point{0, 0}, Point{1.8, 0}, nil, &Disc{X: 0.9, Z: 0.95, R: 0.3}, true},
		{"cuts a corner", Point{-0.4, 0.8}, Point{-1.6, 2}, nil, nil, false},
		{"round the corner", Point{-1.4, 0.8}, Point{-1.6, 2.5}, nil, nil, true},
	}
	for _, tc := range tests {
		m := Map{Spacing: lattice, Areas: []Area{ground, leg}}
		if tc.disc != nil {
			m.Discs = []Disc{*tc.disc}
		}
		b, err := newBuilder(m, DefaultParams())
		if err != nil {
			t.Fatal(err)
		}
		i, j := b.add(tc.a, Stand), b.add(tc.b, Stand)
		if tc.bystander != nil {
			b.add(*tc.bystander, Stand)
		}
		if got := b.linkable(i, j); got != tc.want {
			t.Errorf("%s: linkable = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// A plain rect is its hex grid, less a few edges at the row ends: there a
// blob from inside would have to turn 120° either way (a trap entry), so
// Build cuts one edge each, leaving the end a pocket, a dead end or a gentle
// corner. Nothing is added, every edge joins neighbours, and pockets and
// dead ends are not goals.
func TestBuildHexPatch(t *testing.T) {
	row := lattice * math.Sqrt(3) / 2
	r := Rect{MinX: 0, MaxX: 8.4, MinZ: 0, MaxZ: 1.2 + 2*row}
	m := Map{Spacing: lattice}
	m.Areas = []Area{area("square", r, Point{1.5, 0.6}, &m)}
	if n := len(m.Areas[0].Spots); n != 13 {
		t.Fatalf("fixture has %d spots, want 13", n)
	}
	g, rep, err := BuildReport(m, DefaultParams())
	if err != nil {
		t.Fatal(err)
	}
	if g.Len() != 13 || g.NumStand != 13 {
		t.Fatalf("graph has %d nodes (%d Stand), want 13 Stand only", g.Len(), g.NumStand)
	}
	edges := 0
	for u := range g.Len() {
		nb := g.Neighbors(u)
		edges += len(nb)
		for _, v := range nb {
			if d := dist(g.Nodes[u], g.Nodes[v]); math.Abs(d-lattice) > 1e-9 {
				t.Errorf("edge %d-%d is %.3f long, want a neighbour %.1f away", u, v, d, lattice)
			}
		}
		pocket := len(nb) == 2 && slices.Contains(g.Neighbors(int(nb[0])), nb[1])
		if (pocket || len(nb) < 2) && g.GoalOK(u) {
			t.Errorf("node %d (%d neighbours, pocket %v) is a goal", u, len(nb), pocket)
		}
	}
	// The full grid has 26 edges.
	if edges/2+rep.TrapCuts != 26 || rep.TrapCuts == 0 {
		t.Errorf("%d edges and %d cut, want 26 in all with some cut", edges/2, rep.TrapCuts)
	}
	t.Logf("%d edges cut, %d goals lost", rep.TrapCuts, rep.GoalsLost)
}

// lawnMap copies the park block without its trees: a lawn ringed by four
// sidewalks, lamps in the corners. The lawn's spots stop a reach short of
// its edge, and the north and south sidewalks' rows line up with the lawn's
// even rows, 1.515 off the last cell of the lawn's grid.
func lawnMap() Map {
	m := Map{Spacing: lattice}
	for _, x := range []float64{-22.2, 22.2} {
		for _, z := range []float64{19.8, 36.2} {
			m.Discs = append(m.Discs, Disc{X: x, Z: z, R: 0.3})
		}
	}
	// Anchors as layoutCity.sidewalkStrips for an unwalled block.
	fromKerb := (0.6 + 2.5 - 0.6) / 2
	m.Areas = []Area{
		area("park", Rect{MinX: -20.5, MaxX: 20.5, MinZ: 21.5, MaxZ: 34.5}, Point{0, 28}, &m),
		area("north", Rect{MinX: -23, MaxX: 23, MinZ: 19, MaxZ: 21.5}, Point{0, 19 + fromKerb}, &m),
		area("south", Rect{MinX: -23, MaxX: 23, MinZ: 34.5, MaxZ: 37}, Point{0, 37 - fromKerb}, &m),
		area("west", Rect{MinX: -23, MaxX: -20.5, MinZ: 21.5, MaxZ: 34.5}, Point{-23 + fromKerb - lattice/4, 28}, &m),
		area("east", Rect{MinX: 20.5, MaxX: 23, MinZ: 21.5, MaxZ: 34.5}, Point{23 - fromKerb - lattice/4, 28}, &m),
	}
	return m
}

// Where a lawn meets a 1-wide sidewalk, the row of cells between follows the
// sidewalk's grid, half a step off its spots, so stepping off the lawn is a
// gentle turn onto the sidewalk. On the lawn's grid the row would sit square
// under the spots: a 90° turn either way with legs of 1.515 and 1.8 (swept
// 1.159), a trap entry at every one, which W4 found stalling walkers.
func TestBuildLawnMeetsSidewalk(t *testing.T) {
	m := lawnMap()
	g, rep, err := BuildReport(m, DefaultParams())
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%d nodes, %d trap edges cut, %d goals lost", g.Len(), rep.TrapCuts, rep.GoalsLost)
	lawn, north := m.Areas[0].Spots, m.Areas[1].Spots
	south := m.Areas[2].Spots
	start := len(lawn) + len(north) // first south spot's id
	for k, s := range south {
		// Nothing sits square under a south spot, 1.515 into the lawn.
		for u, p := range g.Nodes {
			if math.Abs(p.X-s.X) < 0.05 && math.Abs(s.Z-p.Z-1.515) < 0.05 {
				t.Errorf("%s node %d at %v sits square under south spot %v", kindName(g.Kinds[u]), u, p, s)
			}
		}
		// And each is a few steps from the lawn spot nearest above it.
		above := -1
		for l, q := range lawn {
			if math.Abs(q.X-s.X) <= lattice/2 && (above < 0 || q.Z > lawn[above].Z) {
				above = l
			}
		}
		if h := g.Hops(start+k, above); above >= 0 && (h < 0 || h > 3) {
			t.Errorf("south spot %v is %d hops from lawn spot %v, want <= 3", s, h, lawn[above])
		}
	}
	if rep.GoalsLost > 0 {
		t.Errorf("%d spots stopped being goals", rep.GoalsLost)
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

// Two rows 1.515 apart joined by rungs: a sidewalk and a lawn's row square
// under it. Every rung has a 90° turn with short legs at one end at least,
// so no set of cuts leaves it in one piece without a trap. Build must say
// so, not hand back a graph that stalls walkers.
func TestBuildReportsTrapsItCannotCut(t *testing.T) {
	m := Map{Spacing: lattice}
	m.Areas = []Area{
		{Name: "sidewalk", Rect: Rect{MinX: -0.6, MaxX: 4.2, MinZ: -0.6, MaxZ: 0.6},
			Spots: []Point{{0, 0}, {1.8, 0}, {3.6, 0}}},
		{Name: "lawn", Rect: Rect{MinX: -0.6, MaxX: 4.2, MinZ: -2.115, MaxZ: -0.6},
			Spots: []Point{{0, -1.515}, {1.8, -1.515}, {3.6, -1.515}}},
	}
	_, err := Build(m, DefaultParams())
	if err == nil || !strings.Contains(err.Error(), "trap entries could not be cut") {
		t.Fatalf("err = %v, want trap entries reported", err)
	}
}

func TestBuildDeterministic(t *testing.T) {
	for name, m := range map[string]Map{"crosswalk": crosswalkMap(), "corner": cornerMap(), "lawn": lawnMap()} {
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

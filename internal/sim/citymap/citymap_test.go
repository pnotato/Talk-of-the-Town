package citymap

import (
	"math"
	"slices"
	"strings"
	"testing"

	"talkofthetown/internal/sim/nav"
)

// cityFingerprint pins the real city's walk graph. It changes whenever the
// city (make citymap) or the build changes; update it deliberately, after
// looking at the new graph (TestSVG), and say why in the commit.
//
// Last changed: no trap entries (CheckGraph rule 4 now covers every node).
// Grid fill puts the row between the park's lawn and its sidewalks on the
// sidewalks' grid, bridges never add a trap, and a last stage cuts the 28
// left at hex row ends.
const cityFingerprint = 0x2f8815783ff8d06d

func TestLoad(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	spots := 0
	for _, a := range m.Areas {
		spots += len(a.Spots)
	}
	got := []int{len(m.Areas), spots, len(m.Crosswalks), len(m.Discs), len(m.Boxes)}
	want := []int{34, 752, 24, 50, 15}
	for i, name := range []string{"areas", "spots", "crosswalks", "discs", "boxes"} {
		if got[i] != want[i] {
			t.Errorf("%d %s, want %d", got[i], name, want[i])
		}
	}
	if m.Spacing != SpotSpacing || m.Areas[0].Name != "plaza" {
		t.Errorf("spacing %v, first area %q; want %v and plaza", m.Spacing, m.Areas[0].Name, SpotSpacing)
	}
}

// tinyCity is a valid city.json small enough to break by hand: three spots
// on one grid, a crosswalk, a lamp and a kiosk.
const tinyCity = `{"version":1,"layout":{"homeCount":1,"neighbourhoodCount":1},"blobRadius":0.6,"spotSpacing":1.8,
"areas":[{"name":"plaza","rect":{"minX":0,"maxX":6,"minZ":0,"maxZ":4},"spots":[[1,1],[2.8,1],[1.9,2.558846]]}],
"crosswalks":[{"rect":{"minX":6,"maxX":13,"minZ":1,"maxZ":3.4},"axis":"x"}],
"discs":[{"kind":"lamp","x":0.2,"z":0.2,"r":0.1}],
"boxes":[{"kind":"kiosk","rect":{"minX":4,"maxX":5,"minZ":3,"maxZ":3.9}}]}
`

func TestParseTiny(t *testing.T) {
	m, err := parse("city", []byte(tinyCity))
	if err != nil {
		t.Fatal(err)
	}
	want := nav.Point{X: 1.9, Z: 2.558846}
	if len(m.Areas) != 1 || len(m.Areas[0].Spots) != 3 || m.Areas[0].Spots[2] != want {
		t.Errorf("areas = %+v", m.Areas)
	}
	if len(m.Crosswalks) != 1 || m.Crosswalks[0].Axis != nav.AxisX {
		t.Errorf("crosswalks = %+v", m.Crosswalks)
	}
	if len(m.Discs) != 1 || len(m.Boxes) != 1 {
		t.Errorf("discs %+v boxes %+v", m.Discs, m.Boxes)
	}
}

func TestParseRejects(t *testing.T) {
	tests := []struct {
		name     string
		old, new string
		want     string
	}{
		{"unknown field", `"version":1,`, `"version":1,"colour":"red",`, "unknown field"},
		{"wrong version", `"version":1,`, `"version":2,`, "version 2"},
		{"wrong radius", `"blobRadius":0.6`, `"blobRadius":0.5`, "blobRadius"},
		{"wrong spacing", `"spotSpacing":1.8`, `"spotSpacing":2`, "spotSpacing"},
		{"off-grid spot", `[2.8,1]`, `[2.9,1]`, "off the grid"},
		{"off-grid row", `[1.9,2.558846]`, `[1.9,2.6]`, "off the grid"},
		{"spot near an edge", `[1,1]`, `[0.5,1]`, "from the area's edge"},
		{"three coordinates", `[2.8,1]`, `[2.8,1,0]`, "3 coordinates"},
		{"bad axis", `"axis":"x"`, `"axis":"y"`, "axis"},
		{"empty disc", `"r":0.1`, `"r":0`, "radius"},
		{"empty box", `"maxX":5,`, `"maxX":4,`, "empty rect"},
		{"no areas", `"areas":[{"name":"plaza","rect":{"minX":0,"maxX":6,"minZ":0,"maxZ":4},"spots":[[1,1],[2.8,1],[1.9,2.558846]]}]`, `"areas":[]`, "no areas"},
		{"trailing data", "}\n", "}\n{}", "trailing"},
		{"wrong type", `"version":1`, `"version":"1"`, "version"},
	}
	for _, tc := range tests {
		data := strings.Replace(tinyCity, tc.old, tc.new, 1)
		if data == tinyCity {
			t.Fatalf("%s: fixture text %q not found", tc.name, tc.old)
		}
		_, err := parse("city", []byte(data))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want it to mention %q", tc.name, err, tc.want)
		}
	}
}

func TestGraph(t *testing.T) {
	g, err := Graph()
	if err != nil {
		t.Fatal(err)
	}
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	p := nav.DefaultParams()
	if err := nav.Check(g, p, &m); err != nil {
		t.Fatal(err)
	}
	if g.NumStand != 752 {
		t.Errorf("%d Stand nodes, want 752", g.NumStand)
	}
	// Check already asks for one piece and no trap entries (CheckGraph rule
	// 4); say it plainly here too.
	for u := range g.Len() {
		if g.Hops(0, u) < 0 {
			t.Fatalf("node %d is cut off", u)
		}
	}
	// Build again for its report: what each stage did.
	g2, rep, err := nav.BuildReport(m, p)
	if err != nil {
		t.Fatal(err)
	}
	if g2.Fingerprint() != g.Fingerprint() {
		t.Error("BuildReport built a different graph")
	}
	for k, name := range []string{"spots", "grid fill", "crosswalk chains", "gap bridges"} {
		t.Logf("after %s: %d nodes, %d pieces", name, rep.Nodes[k], rep.Pieces[k])
	}
	t.Logf("bridges: %d routed, %d one-point, %d two-point; %d gap pairs left; %d fills cleared",
		rep.Routed, rep.OnePoint, rep.TwoPoint, rep.Unjoined, rep.Cleared)
	t.Logf("trap entries: %d edges cut, %d spots lost as goals", rep.TrapCuts, rep.GoalsLost)
	if rep.GoalsLost > 0 {
		t.Errorf("cutting trap entries cost %d goals, want 0", rep.GoalsLost)
	}

	kinds := map[nav.Kind]int{}
	edges, deadEnds, core, standCore, goals, pockets := 0, 0, 0, 0, 0, 0
	for u := range g.Len() {
		kinds[g.Kinds[u]]++
		nb := g.Neighbors(u)
		edges += len(nb)
		if len(nb) == 1 {
			deadEnds++
		}
		if g.Core(u) {
			core++
			if g.Kinds[u] == nav.Stand {
				standCore++
			}
		}
		if g.GoalOK(u) {
			goals++
		}
		// A pocket: two neighbours joined to each other, a hex area's corner.
		if g.Kinds[u] == nav.Stand && len(nb) == 2 && slices.Contains(g.Neighbors(int(nb[0])), nb[1]) {
			pockets++
		}
	}
	edges /= 2
	minSep := math.Inf(1)
	for u, a := range g.Nodes {
		for _, b := range g.Nodes[u+1:] {
			minSep = min(minSep, math.Hypot(a.X-b.X, a.Z-b.Z))
		}
	}
	standCoreFrac := float64(standCore) / float64(g.NumStand)
	goalFrac := float64(goals) / float64(g.NumStand)
	t.Logf("%d nodes (stand %d, fill %d, crossing %d, bridge %d), %d edges, %d dead ends",
		g.Len(), kinds[nav.Stand], kinds[nav.Fill], kinds[nav.Crossing], kinds[nav.Bridge], edges, deadEnds)
	t.Logf("min spacing %.4f (MinSep %.2f); 2-core %d nodes, %d of %d Stand (%.1f%%)",
		minSep, p.MinSep, core, standCore, g.NumStand, 100*standCoreFrac)
	t.Logf("goals (GoalOK) %d of %d Stand (%.1f%%); %d Stand nodes are pockets", goals, g.NumStand, 100*goalFrac, pockets)
	t.Logf("fingerprint %#x", g.Fingerprint())

	if minSep < p.MinSep {
		t.Errorf("min spacing %.4f < MinSep %.2f", minSep, p.MinSep)
	}
	// Goals must be in the 2-core and not pockets (see PIBT.md); a few
	// corner spots lost as goals are fine, more would mean the build lost
	// the plot.
	if standCoreFrac < 0.95 {
		t.Errorf("only %.1f%% of Stand nodes are in the 2-core, want >= 95%%", 100*standCoreFrac)
	}
	if goalFrac < 0.95 {
		t.Errorf("only %.1f%% of Stand nodes may be goals, want >= 95%%", 100*goalFrac)
	}
	if got := g.Fingerprint(); got != cityFingerprint {
		t.Errorf("fingerprint %#x, want %#x: the city graph changed; if that's intended, look at it (TestSVG) and update cityFingerprint", got, uint64(cityFingerprint))
	}
}

func TestGraphIsCached(t *testing.T) {
	g1, err1 := Graph()
	g2, err2 := Graph()
	if g1 != g2 || err1 != err2 {
		t.Error("Graph built twice")
	}
	t1, err1 := TownGraph()
	t2, err2 := TownGraph()
	if t1 != t2 || err1 != err2 {
		t.Error("TownGraph built twice")
	}
	h1, err1 := HarbourGraph()
	h2, err2 := HarbourGraph()
	if h1 != h2 || err1 != err2 {
		t.Error("HarbourGraph built twice")
	}
}

// townFingerprint pins the real town's walk graph. It changes whenever the
// town (make townmap) or the build changes; update it deliberately, after
// looking at the new graph, and say why in the commit.
const townFingerprint = 0xc39294705074354b

func TestLoadTown(t *testing.T) {
	m, err := LoadTown()
	if err != nil {
		t.Fatal(err)
	}
	spots := 0
	for _, a := range m.Areas {
		spots += len(a.Spots)
	}
	got := []int{len(m.Areas), spots, len(m.Crosswalks), len(m.Discs), len(m.Boxes)}
	want := []int{1, 412, 0, 12, 15}
	for i, name := range []string{"areas", "spots", "crosswalks", "discs", "boxes"} {
		if got[i] != want[i] {
			t.Errorf("%d %s, want %d", got[i], name, want[i])
		}
	}
	if m.Areas[0].Name != "square" {
		t.Errorf("first area %q, want square", m.Areas[0].Name)
	}
}

func TestTownGraph(t *testing.T) {
	g, err := TownGraph()
	if err != nil {
		t.Fatal(err)
	}
	m, err := LoadTown()
	if err != nil {
		t.Fatal(err)
	}
	p := nav.DefaultParams()
	if err := nav.Check(g, p, &m); err != nil {
		t.Fatal(err)
	}
	if g.NumStand != 412 {
		t.Errorf("%d Stand nodes, want 412", g.NumStand)
	}
	goals := 0
	for u := range g.NumStand {
		if g.GoalOK(u) {
			goals++
		}
	}
	t.Logf("%d nodes (%d stand), %d goals, fingerprint %#x", g.Len(), g.NumStand, goals, g.Fingerprint())
	if goals < 100 {
		t.Errorf("only %d goal nodes, want at least 100 for the town's blobs", goals)
	}
	if got := g.Fingerprint(); got != townFingerprint {
		t.Errorf("fingerprint %#x, want %#x: the town graph changed; if that's intended, look at it and update townFingerprint", got, uint64(townFingerprint))
	}
}

// harbourFingerprint pins the real harbour's walk graph. It changes whenever
// the harbour (make harbourmap) or the build changes; update it deliberately,
// after looking at the new graph, and say why in the commit.
const harbourFingerprint = 0xbc272a4fd4c64eef

func TestLoadHarbour(t *testing.T) {
	m, err := LoadHarbour()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	spots := 0
	for _, a := range m.Areas {
		names = append(names, a.Name)
		spots += len(a.Spots)
	}
	got := []int{len(m.Areas), spots, len(m.Crosswalks), len(m.Discs), len(m.Boxes)}
	want := []int{4, 718, 0, 16, 11}
	for i, name := range []string{"areas", "spots", "crosswalks", "discs", "boxes"} {
		if got[i] != want[i] {
			t.Errorf("%d %s, want %d", got[i], name, want[i])
		}
	}
	if w := []string{"green", "boardwalk", "pier", "pierhead"}; !slices.Equal(names, w) {
		t.Errorf("areas %q, want %q", names, w)
	}
}

func TestHarbourGraph(t *testing.T) {
	g, err := HarbourGraph()
	if err != nil {
		t.Fatal(err)
	}
	m, err := LoadHarbour()
	if err != nil {
		t.Fatal(err)
	}
	if err := nav.Check(g, nav.DefaultParams(), &m); err != nil {
		t.Fatal(err)
	}
	if g.NumStand != 718 {
		t.Errorf("%d Stand nodes, want 718", g.NumStand)
	}
	// One piece: the pier and the pier head are reached over the boardwalk.
	for u := range g.Len() {
		if g.Hops(0, u) < 0 {
			t.Fatalf("node %d at %+v is cut off", u, g.Nodes[u])
		}
	}
	goals := 0
	for u := range g.NumStand {
		if g.GoalOK(u) {
			goals++
		}
	}
	t.Logf("%d nodes (%d stand), %d goals, fingerprint %#x", g.Len(), g.NumStand, goals, g.Fingerprint())
	// Room to wander: far more goals than the 100 blobs, as in the city.
	if frac := float64(goals) / float64(g.NumStand); frac < 0.95 {
		t.Errorf("only %.1f%% of Stand nodes may be goals, want >= 95%%", 100*frac)
	}
	if got := g.Fingerprint(); got != harbourFingerprint {
		t.Errorf("fingerprint %#x, want %#x: the harbour graph changed; if that's intended, look at it and update harbourFingerprint", got, uint64(harbourFingerprint))
	}
}

// BenchmarkBuild times one build of the real city, Check included.
func BenchmarkBuild(b *testing.B) {
	m, err := Load()
	if err != nil {
		b.Fatal(err)
	}
	for b.Loop() {
		if _, err := nav.Build(m, nav.DefaultParams()); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkCheck times Check alone on the real city, the part of
// BenchmarkBuild that re-verifies the result by brute force.
func BenchmarkCheck(b *testing.B) {
	m, err := Load()
	if err != nil {
		b.Fatal(err)
	}
	g, err := Graph()
	if err != nil {
		b.Fatal(err)
	}
	for b.Loop() {
		if err := nav.Check(g, nav.DefaultParams(), &m); err != nil {
			b.Fatal(err)
		}
	}
}

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
const cityFingerprint = 0xdcd05acfc02273c2

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
	m, err := parse([]byte(tinyCity))
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
		_, err := parse([]byte(data))
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
	// Check already asks for one piece; say it plainly here too.
	for u := range g.Len() {
		if g.Hops(0, u) < 0 {
			t.Fatalf("node %d is cut off", u)
		}
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

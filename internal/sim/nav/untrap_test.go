package nav

import (
	"slices"
	"strings"
	"testing"
)

// hexCorner is a triangle with a spur 3-0: nodes 0 and 1 are corners of a
// wider area and node 2 is a pocket on a 60° corner. It passes CheckGraph.
func hexCorner() ([]Point, [][2]int) {
	return []Point{pnt(0, 0), pnt(lattice, 0), pnt(lattice/2, hexRise), pnt(-lattice, 0)},
		[][2]int{{0, 1}, {1, 2}, {2, 0}, {3, 0}}
}

func TestUntrap(t *testing.T) {
	cornerNodes, cornerEdges := hexCorner()
	// A 4 x 3 hex patch: row ends trap blobs coming from inside.
	patch := hexLattice(4, 3, 0, 0, false, nil)
	tests := []struct {
		name  string
		nodes []Point
		edges [][2]int
		cuts  int    // edges Untrap should cut; -1 for any
		err   string // wanted error, if any
	}{
		{"nothing to cut", cornerNodes, cornerEdges, 0, ""},
		{"hex patch", patch, linkWithin(patch, fixtureLink), -1, ""},
		// Two hex triangles sharing an edge: whatever is cut, some node
		// left joining two others turns 120°.
		{"rhombus", []Point{pnt(0, 0), pnt(-lattice, 0), pnt(-lattice/2, hexRise), pnt(lattice/2, hexRise)},
			[][2]int{{0, 1}, {0, 2}, {0, 3}, {1, 2}, {2, 3}}, 0, "trap entries left"},
		// Two rows 1.515 apart joined by rungs: no cut fixes it all.
		{"ladder", []Point{pnt(0, 0), pnt(lattice, 0), pnt(2*lattice, 0), pnt(0, 1.515), pnt(lattice, 1.515), pnt(2*lattice, 1.515)},
			[][2]int{{0, 1}, {1, 2}, {3, 4}, {4, 5}, {0, 3}, {1, 4}, {2, 5}}, 0, "trap entries left"},
		{"bad edge", cornerNodes, [][2]int{{0, 9}}, 0, "bad edge"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			kinds := allStand(len(tc.nodes))
			out, err := Untrap(tc.nodes, kinds, tc.edges, DefaultParams())
			if tc.err != "" {
				if err == nil || !strings.Contains(err.Error(), tc.err) {
					t.Fatalf("err = %v, want %q", err, tc.err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if cut := len(tc.edges) - len(out); tc.cuts >= 0 && cut != tc.cuts || tc.cuts < 0 && cut == 0 {
				t.Errorf("cut %d edges, want %d", cut, tc.cuts)
			}
			for _, e := range out {
				if !slices.Contains(tc.edges, e) {
					t.Errorf("edge %v is new", e)
				}
			}
			g := mustValidGraph(t, tc.nodes, kinds, out)
			for v := range g.Len() {
				if g.Hops(0, v) < 0 {
					t.Errorf("node %d cut off", v)
				}
			}
		})
	}
}

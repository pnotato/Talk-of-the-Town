package nav

import (
	"slices"
	"strings"
	"testing"
)

// graphParts takes a graph apart so a test can change it and rebuild it.
func graphParts(g *Graph) ([]Point, []Kind, [][2]int) {
	var edges [][2]int
	for u := range g.Len() {
		for _, v := range g.Neighbors(u) {
			if int(v) > u {
				edges = append(edges, [2]int{u, int(v)})
			}
		}
	}
	return slices.Clone(g.Nodes), slices.Clone(g.Kinds), edges
}

func TestCheckPassesBuiltGraphs(t *testing.T) {
	for name, m := range map[string]Map{"crosswalk": crosswalkMap(), "corner": cornerMap()} {
		if err := Check(mustBuild(t, m), DefaultParams(), &m); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestCheckCatches(t *testing.T) {
	p := DefaultParams()
	base := crosswalkMap()
	built := mustBuild(t, base)
	nodes, kinds, edges := graphParts(built)
	firstCrossing := slices.Index(kinds, Crossing)

	// An L of two sidewalks with one edge cutting the inside corner.
	lMap := Map{Spacing: lattice, Areas: []Area{
		{Rect: Rect{MinX: 0, MaxX: 8.4, MinZ: 0, MaxZ: 2.5}, Spots: []Point{{3.4, 2.0}}},
		{Rect: Rect{MinX: 0, MaxX: 2.5, MinZ: 2.5, MaxZ: 8}, Spots: []Point{{2.0, 3.2}}},
	}}

	tests := []struct {
		name string
		// graph returns the graph to check; nil means the built one.
		graph func(t *testing.T) *Graph
		m     *Map
		want  string
	}{
		{
			name: "node nudged 0.3 toward a neighbour",
			graph: func(t *testing.T) *Graph {
				n := slices.Clone(nodes)
				nb := built.Neighbors(1)
				d := dist(n[1], n[nb[0]])
				n[1] = lerp(n[1], n[nb[0]], 0.3/d)
				return mustGraph(t, n, kinds, edges)
			},
			want: "(MaxEdge)", // its edge on the other side stretches to 2.1
		},
		{
			name: "stand node moved off its spot",
			graph: func(t *testing.T) *Graph {
				n := slices.Clone(nodes)
				n[1].Z += 0.01
				return mustGraph(t, n, kinds, edges)
			},
			m:    &base,
			want: "Stand node 1 is at",
		},
		{
			name: "crosswalk narrowed off its chain",
			m: func() *Map {
				m := crosswalkMap()
				m.Crosswalks[0].Rect.MaxX = 5.9
				return &m
			}(),
			want: "off the walkable ground",
		},
		{
			name: "edge through an obstacle",
			m: func() *Map {
				m := crosswalkMap()
				a, b := nodes[0], nodes[built.Neighbors(0)[0]]
				mid := lerp(a, b, 0.5)
				m.Discs = []Disc{{X: mid.X, Z: mid.Z, R: 0.1}}
				return &m
			}(),
			want: "passes 0.000 from an obstacle",
		},
		{
			name: "node too close to an obstacle",
			m: func() *Map {
				m := crosswalkMap()
				m.Discs = []Disc{{X: nodes[firstCrossing].X + 0.8, Z: nodes[firstCrossing].Z, R: 0.3}}
				return &m
			}(),
			want: "from an obstacle, want >= 0.600",
		},
		{
			name: "edge leaving the walkable ground",
			graph: func(t *testing.T) *Graph {
				return mustGraph(t, []Point{{3.4, 2.0}, {2.0, 3.2}}, allStand(2), [][2]int{{0, 1}})
			},
			m:    &lMap,
			want: "edge 0-1 leaves the walkable ground",
		},
		{
			name: "two pieces",
			graph: func(t *testing.T) *Graph {
				cut := slices.DeleteFunc(slices.Clone(edges), func(e [2]int) bool {
					return kinds[e[0]] == Crossing && kinds[e[1]] == Crossing
				})
				return mustGraph(t, nodes, kinds, cut)
			},
			m:    &base,
			want: "is not connected to node 0",
		},
		{
			name: "crosswalk with no chain",
			m: func() *Map {
				m := crosswalkMap()
				m.Crosswalks = append(m.Crosswalks, Crosswalk{Rect: Rect{MinX: 9.6, MaxX: 12, MinZ: 2.5, MaxZ: 9.5}, Axis: AxisZ})
				return &m
			}(),
			want: "crosswalk 1",
		},
		{
			name: "a spot missing",
			m: func() *Map {
				m := crosswalkMap()
				m.Areas[1].Spots = m.Areas[1].Spots[:len(m.Areas[1].Spots)-1]
				return &m
			}(),
			want: "Stand nodes, map has",
		},
		{
			name: "dropped conflict entry",
			graph: func(t *testing.T) *Graph {
				g := mustGraph(t, nodes, kinds, edges)
				m := 0
				for g.confOff[m+1] == g.confOff[m] {
					m++
				}
				g.conf = slices.Delete(g.conf, int(g.confOff[m]), int(g.confOff[m])+1)
				for k := m + 1; k < len(g.confOff); k++ {
					g.confOff[k]--
				}
				return g
			},
			want: "conflict table is missing",
		},
		{
			name: "corridor turn too sharp to pass through",
			graph: func(t *testing.T) *Graph {
				return mustGraph(t, []Point{{0, 0}, {1.8, 0}, {1.8, 1.5}}, allStand(3), [][2]int{{0, 1}, {1, 2}})
			},
			want: "node 1 traps blobs from 0",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := built
			if tc.graph != nil {
				g = tc.graph(t)
			}
			err := Check(g, p, tc.m)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Check = %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

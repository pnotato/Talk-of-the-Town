package nav

import "fmt"

// Check is CheckGraph plus the geometry the graph was built from, when m is
// not nil: the Stand nodes are the map's standing spots in order; every node
// and every edge stays on walkable ground (areas and crosswalks) and keeps
// Radius from obstacles; the graph is one piece; and every crosswalk is
// crossed by a chain of edges inside it. It returns the first rule broken.
func Check(g *Graph, p Params, m *Map) error {
	if err := CheckGraph(g, p); err != nil {
		return err
	}
	if m == nil {
		return nil
	}
	if err := checkStands(g, m); err != nil {
		return err
	}
	rects := make([]Rect, 0, len(m.Areas)+len(m.Crosswalks))
	for _, a := range m.Areas {
		rects = append(rects, a.Rect)
	}
	for _, c := range m.Crosswalks {
		rects = append(rects, c.Rect)
	}
	walk := newUnion(rects)
	obs := obstacles{discs: m.Discs, boxes: m.Boxes}
	for u, q := range g.Nodes {
		if !walk.contains(q) {
			return fmt.Errorf("nav: node %d at (%.3f, %.3f) is off the walkable ground", u, q.X, q.Z)
		}
		if d := obs.dist(q); d < p.Radius {
			return fmt.Errorf("nav: node %d at (%.3f, %.3f) is %.3f from an obstacle, want >= %.3f (Radius)",
				u, q.X, q.Z, d, p.Radius)
		}
	}
	for u := range g.Nodes {
		for _, v := range g.adj[g.off[u]:g.off[u+1]] {
			if int(v) < u {
				continue
			}
			a, b := g.Nodes[u], g.Nodes[v]
			if !walk.containsSeg(a, b) {
				return fmt.Errorf("nav: edge %d-%d leaves the walkable ground", u, v)
			}
			if d := obs.segDist(a, b); d < p.Radius {
				return fmt.Errorf("nav: edge %d-%d passes %.3f from an obstacle, want >= %.3f (Radius)", u, v, d, p.Radius)
			}
		}
	}
	if g.Len() > 0 {
		for u := range g.Nodes {
			if g.Hops(0, u) < 0 {
				return fmt.Errorf("nav: node %d (%s) at (%.3f, %.3f) is not connected to node 0",
					u, kindName(g.Kinds[u]), g.Nodes[u].X, g.Nodes[u].Z)
			}
		}
	}
	for i, c := range m.Crosswalks {
		if !crossed(g.Nodes, func(u int32) []int32 { return g.adj[g.off[u]:g.off[u+1]] }, c) {
			return fmt.Errorf("nav: crosswalk %d at %+v has no chain of edges across it", i, c.Rect)
		}
	}
	return nil
}

func checkStands(g *Graph, m *Map) error {
	k := 0
	for ai, a := range m.Areas {
		for si, s := range a.Spots {
			if k >= g.NumStand {
				return fmt.Errorf("nav: graph has %d Stand nodes, map has more spots", g.NumStand)
			}
			if g.Nodes[k] != s {
				return fmt.Errorf("nav: Stand node %d is at %v, want area %d spot %d at %v", k, g.Nodes[k], ai, si, s)
			}
			k++
		}
	}
	if k != g.NumStand {
		return fmt.Errorf("nav: graph has %d Stand nodes, map has %d spots", g.NumStand, k)
	}
	return nil
}

// crossed reports whether some path runs from one kerb of c to the other
// through nodes on the crosswalk itself. nbrs lists a node's neighbours.
func crossed(pts []Point, nbrs func(u int32) []int32, c Crosswalk) bool {
	r := c.Rect
	along := func(q Point) float64 { return q.X }
	lo, hi := r.MinX, r.MaxX
	if c.Axis == AxisZ {
		along = func(q Point) float64 { return q.Z }
		lo, hi = r.MinZ, r.MaxZ
	}
	on := func(u int32) bool {
		a := along(pts[u])
		return a > lo+eps && a < hi-eps && inRect(r, pts[u])
	}
	sideA := func(u int32) bool { return along(pts[u]) <= lo+eps }
	sideB := func(u int32) bool { return along(pts[u]) >= hi-eps }

	seen := make([]bool, len(pts))
	var queue []int32
	for u := range pts {
		if !sideA(int32(u)) {
			continue
		}
		for _, v := range nbrs(int32(u)) {
			if sideB(v) && inRect(r, lerp(pts[u], pts[v], 0.5)) {
				return true // a single step across a very narrow road
			}
			if on(v) && !seen[v] {
				seen[v] = true
				queue = append(queue, v)
			}
		}
	}
	for head := 0; head < len(queue); head++ {
		for _, v := range nbrs(queue[head]) {
			if sideB(v) {
				return true
			}
			if on(v) && !seen[v] {
				seen[v] = true
				queue = append(queue, v)
			}
		}
	}
	return false
}

func kindName(k Kind) string {
	switch k {
	case Stand:
		return "stand"
	case Fill:
		return "fill"
	case Crossing:
		return "crossing"
	case Bridge:
		return "bridge"
	}
	return fmt.Sprintf("kind %d", k)
}

package nav

import (
	"math"
	"slices"
)

// Arithmetic here feeds threshold tests that decide which nodes and edges
// exist, so every product is wrapped in float64(...): the explicit conversion
// stops the compiler fusing a*b+c into one FMA on some platforms and not
// others, which would flip ties and change the graph.

// eps absorbs rounding in containment and coverage tests.
const eps = 1e-9

// quantum is the step computed node coordinates are rounded to, so a node
// placed by arithmetic prints and compares the same everywhere.
const quantum = 1e6

func quantise(v float64) float64 { return math.Round(float64(v*quantum)) / quantum }

func quantisePoint(p Point) Point { return Point{quantise(p.X), quantise(p.Z)} }

func dist(a, b Point) float64 {
	dx, dz := a.X-b.X, a.Z-b.Z
	return math.Sqrt(float64(dx*dx) + float64(dz*dz))
}

// lerp is the point a fraction t of the way from a to b.
func lerp(a, b Point, t float64) Point {
	return Point{a.X + float64(t*(b.X-a.X)), a.Z + float64(t*(b.Z-a.Z))}
}

// segPointDist is the distance from p to the segment ab.
func segPointDist(p, a, b Point) float64 {
	dx, dz := b.X-a.X, b.Z-a.Z
	l := float64(dx*dx) + float64(dz*dz)
	if l == 0 {
		return dist(p, a)
	}
	t := (float64((p.X-a.X)*dx) + float64((p.Z-a.Z)*dz)) / l
	t = min(max(t, 0), 1)
	return dist(p, Point{a.X + float64(t*dx), a.Z + float64(t*dz)})
}

// segParam is how far along ab (0 at a, 1 at b, unclamped) p projects.
func segParam(p, a, b Point) float64 {
	dx, dz := b.X-a.X, b.Z-a.Z
	l := float64(dx*dx) + float64(dz*dz)
	if l == 0 {
		return 0
	}
	return (float64((p.X-a.X)*dx) + float64((p.Z-a.Z)*dz)) / l
}

func inRect(r Rect, p Point) bool {
	return p.X >= r.MinX-eps && p.X <= r.MaxX+eps && p.Z >= r.MinZ-eps && p.Z <= r.MaxZ+eps
}

// rectPointDist is the distance from p to r; 0 inside it.
func rectPointDist(r Rect, p Point) float64 {
	ox := max(r.MinX-p.X, p.X-r.MaxX, 0)
	oz := max(r.MinZ-p.Z, p.Z-r.MaxZ, 0)
	return math.Sqrt(float64(ox*ox) + float64(oz*oz))
}

// clipSeg returns the part of ab inside r as parameters t0 <= t1 along it
// (Liang-Barsky), or ok false if they don't meet.
func clipSeg(a, b Point, r Rect) (t0, t1 float64, ok bool) {
	t0, t1 = 0, 1
	dx, dz := b.X-a.X, b.Z-a.Z
	clip := func(den, num float64) bool {
		// The segment is inside where den*t <= num.
		if den == 0 {
			return num >= -eps
		}
		t := num / den
		if den < 0 {
			t0 = max(t0, t)
		} else {
			t1 = min(t1, t)
		}
		return t0 <= t1+eps
	}
	ok = clip(-dx, a.X-r.MinX+eps) && clip(dx, r.MaxX+eps-a.X) &&
		clip(-dz, a.Z-r.MinZ+eps) && clip(dz, r.MaxZ+eps-a.Z)
	return t0, t1, ok
}

func segHitsRect(a, b Point, r Rect) bool {
	_, _, ok := clipSeg(a, b, r)
	return ok
}

// segRectDist is the distance between segment ab and r; 0 if they meet. Two
// apart convex shapes are closest at a vertex of one, so endpoints against
// the rect and corners against the segment cover it.
func segRectDist(a, b Point, r Rect) float64 {
	if segHitsRect(a, b, r) {
		return 0
	}
	d := min(rectPointDist(r, a), rectPointDist(r, b))
	for _, c := range [4]Point{{r.MinX, r.MinZ}, {r.MaxX, r.MinZ}, {r.MinX, r.MaxZ}, {r.MaxX, r.MaxZ}} {
		d = min(d, segPointDist(c, a, b))
	}
	return d
}

// union is the walkable ground: a union of axis-aligned rects that may touch
// or overlap, with its outline precomputed as segments.
type union struct {
	rects []Rect
	edges [][2]Point
}

func newUnion(rects []Rect) union {
	u := union{rects: rects}
	for i, r := range rects {
		// Each side of r, as a fixed coordinate, a span, and which way is out.
		sides := []struct {
			alongX     bool
			at, lo, hi float64
			out        float64
		}{
			{true, r.MinZ, r.MinX, r.MaxX, -1},
			{true, r.MaxZ, r.MinX, r.MaxX, 1},
			{false, r.MinX, r.MinZ, r.MaxZ, -1},
			{false, r.MaxX, r.MinZ, r.MaxZ, 1},
		}
		for _, s := range sides {
			// Spans of this side covered by another rect on its outside.
			var covered [][2]float64
			for j, q := range rects {
				if j == i {
					continue
				}
				qlo, qhi, qmin, qmax := q.MinX, q.MaxX, q.MinZ, q.MaxZ
				if !s.alongX {
					qlo, qhi, qmin, qmax = q.MinZ, q.MaxZ, q.MinX, q.MaxX
				}
				outside := qmin < s.at-eps && qmax >= s.at-eps
				if s.out > 0 {
					outside = qmax > s.at+eps && qmin <= s.at+eps
				}
				if outside && qhi > s.lo+eps && qlo < s.hi-eps {
					covered = append(covered, [2]float64{max(qlo, s.lo), min(qhi, s.hi)})
				}
			}
			slices.SortFunc(covered, func(a, b [2]float64) int { return cmpFloat(a[0], b[0]) })
			from := s.lo
			emit := func(to float64) {
				if to-from <= eps {
					return
				}
				if s.alongX {
					u.edges = append(u.edges, [2]Point{{from, s.at}, {to, s.at}})
				} else {
					u.edges = append(u.edges, [2]Point{{s.at, from}, {s.at, to}})
				}
			}
			for _, c := range covered {
				if c[0] > from {
					emit(c[0])
				}
				from = max(from, c[1])
			}
			emit(s.hi)
		}
	}
	return u
}

func cmpFloat(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

func (u *union) contains(p Point) bool {
	for _, r := range u.rects {
		if inRect(r, p) {
			return true
		}
	}
	return false
}

// edgeDist is the distance from p to the union's outline: for a point inside,
// how far a blob there can spread before it leaves the walkable ground.
func (u *union) edgeDist(p Point) float64 {
	d := math.Inf(1)
	for _, e := range u.edges {
		d = min(d, segPointDist(p, e[0], e[1]))
	}
	return d
}

// containsSeg reports whether every point of ab is walkable: the parts of ab
// inside each rect must cover it end to end.
func (u *union) containsSeg(a, b Point) bool {
	// Most segments lie in one rect, which is convex.
	for _, r := range u.rects {
		if inRect(r, a) && inRect(r, b) {
			return true
		}
	}
	var spans [][2]float64
	for _, r := range u.rects {
		if t0, t1, ok := clipSeg(a, b, r); ok {
			spans = append(spans, [2]float64{t0, t1})
		}
	}
	slices.SortFunc(spans, func(x, y [2]float64) int { return cmpFloat(x[0], y[0]) })
	reach := 0.0
	for _, s := range spans {
		if s[0] > reach+eps {
			return false
		}
		reach = max(reach, s[1])
	}
	return len(spans) > 0 && reach >= 1-eps
}

// obstacles are what blobs must keep clear of.
type obstacles struct {
	discs []Disc
	boxes []Rect
}

// dist is the distance from p to the nearest obstacle's edge; 0 inside one.
func (o *obstacles) dist(p Point) float64 {
	d := math.Inf(1)
	for _, c := range o.discs {
		d = min(d, max(dist(p, Point{c.X, c.Z})-c.R, 0))
	}
	for _, r := range o.boxes {
		d = min(d, rectPointDist(r, p))
	}
	return d
}

// segDist is the closest segment ab comes to any obstacle.
func (o *obstacles) segDist(a, b Point) float64 {
	d := math.Inf(1)
	for _, c := range o.discs {
		d = min(d, max(segPointDist(Point{c.X, c.Z}, a, b)-c.R, 0))
	}
	for _, r := range o.boxes {
		d = min(d, segRectDist(a, b, r))
	}
	return d
}

// near returns the obstacles within reach of r, for work confined to r.
func (o *obstacles) near(r Rect, reach float64) obstacles {
	var n obstacles
	for _, c := range o.discs {
		if rectPointDist(r, Point{c.X, c.Z}) <= reach+c.R {
			n.discs = append(n.discs, c)
		}
	}
	for _, b := range o.boxes {
		grown := Rect{b.MinX - reach, b.MaxX + reach, b.MinZ - reach, b.MaxZ + reach}
		if grown.MinX <= r.MaxX && grown.MaxX >= r.MinX && grown.MinZ <= r.MaxZ && grown.MaxZ >= r.MinZ {
			n.boxes = append(n.boxes, b)
		}
	}
	return n
}

// nodeIndex buckets node ids on a square grid for neighbourhood queries.
// Buckets are a dense slice, never a map, so queries come back in a fixed
// order. Points beyond the bounds fall into the edge buckets.
type nodeIndex struct {
	bounds  Rect
	cell    float64
	nx, nz  int
	buckets [][]int32
}

func newNodeIndex(bounds Rect, cell float64) *nodeIndex {
	nx := int(math.Ceil((bounds.MaxX-bounds.MinX)/cell)) + 1
	nz := int(math.Ceil((bounds.MaxZ-bounds.MinZ)/cell)) + 1
	return &nodeIndex{bounds: bounds, cell: cell, nx: nx, nz: nz, buckets: make([][]int32, nx*nz)}
}

func (ix *nodeIndex) coord(p Point) (int, int) {
	i := int(math.Floor((p.X - ix.bounds.MinX) / ix.cell))
	j := int(math.Floor((p.Z - ix.bounds.MinZ) / ix.cell))
	return min(max(i, 0), ix.nx-1), min(max(j, 0), ix.nz-1)
}

func (ix *nodeIndex) add(id int32, p Point) {
	i, j := ix.coord(p)
	ix.buckets[j*ix.nx+i] = append(ix.buckets[j*ix.nx+i], id)
}

func (ix *nodeIndex) remove(id int32, p Point) {
	i, j := ix.coord(p)
	b := ix.buckets[j*ix.nx+i]
	if k := slices.Index(b, id); k >= 0 {
		ix.buckets[j*ix.nx+i] = slices.Delete(b, k, k+1)
	}
}

// within appends to out the ids of nodes within r of p, in ascending order.
func (ix *nodeIndex) within(p Point, r float64, pts []Point, out []int32) []int32 {
	start := len(out)
	i0, j0 := ix.coord(Point{p.X - r, p.Z - r})
	i1, j1 := ix.coord(Point{p.X + r, p.Z + r})
	for j := j0; j <= j1; j++ {
		for i := i0; i <= i1; i++ {
			for _, id := range ix.buckets[j*ix.nx+i] {
				if dist(p, pts[id]) <= r {
					out = append(out, id)
				}
			}
		}
	}
	slices.Sort(out[start:])
	return out
}

// nearest is the distance from p to the closest indexed node, capped at r.
// Unlike within it allocates nothing, for the hot loops that only need that.
func (ix *nodeIndex) nearest(p Point, r float64, pts []Point) float64 {
	d := r
	i0, j0 := ix.coord(Point{p.X - r, p.Z - r})
	i1, j1 := ix.coord(Point{p.X + r, p.Z + r})
	for j := j0; j <= j1; j++ {
		for i := i0; i <= i1; i++ {
			for _, id := range ix.buckets[j*ix.nx+i] {
				d = min(d, dist(p, pts[id]))
			}
		}
	}
	return d
}

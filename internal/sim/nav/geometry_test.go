package nav

import (
	"math"
	"testing"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestDistances(t *testing.T) {
	r := Rect{MinX: 0, MaxX: 2, MinZ: 0, MaxZ: 1}
	tests := []struct {
		name string
		got  float64
		want float64
	}{
		{"points", dist(Point{0, 0}, Point{3, 4}), 5},
		{"segment middle", segPointDist(Point{1, 1}, Point{0, 0}, Point{2, 0}), 1},
		{"segment past end", segPointDist(Point{5, 4}, Point{0, 0}, Point{2, 0}), 5},
		{"degenerate segment", segPointDist(Point{3, 4}, Point{0, 0}, Point{0, 0}), 5},
		{"rect inside", rectPointDist(r, Point{1, 0.5}), 0},
		{"rect side", rectPointDist(r, Point{1, 3}), 2},
		{"rect corner", rectPointDist(r, Point{5, 5}), 5},
		{"segment through rect", segRectDist(Point{-1, 0.5}, Point{3, 0.5}, r), 0},
		{"segment beside rect", segRectDist(Point{-1, 2}, Point{3, 2}, r), 1},
		{"segment past corner", segRectDist(Point{3, 0}, Point{4, -1}, r), 1},
		{"corner nearest", segRectDist(Point{3, 3}, Point{5, 1}, r), math.Sqrt(2) * 1.5},
	}
	for _, tc := range tests {
		if !near(tc.got, tc.want) {
			t.Errorf("%s = %v, want %v", tc.name, tc.got, tc.want)
		}
	}
}

func TestSegRectHits(t *testing.T) {
	r := Rect{MinX: 0, MaxX: 2, MinZ: 0, MaxZ: 1}
	tests := []struct {
		a, b Point
		want bool
	}{
		{Point{-1, 0.5}, Point{3, 0.5}, true},
		{Point{1, 0.5}, Point{1, 0.6}, true},
		{Point{-1, -1}, Point{3, 3}, true},
		{Point{-1, 2}, Point{3, 2}, false},
		{Point{3, -1}, Point{3, 2}, false},
		{Point{2.5, 0}, Point{3, 1}, false},
	}
	for _, tc := range tests {
		if got := segHitsRect(tc.a, tc.b, r); got != tc.want {
			t.Errorf("segHitsRect(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

// An L of two rects that share an edge, plus a crosswalk-like strip off one
// side: the shared edges are not boundary, the outer ones are.
func TestUnion(t *testing.T) {
	u := newUnion([]Rect{
		{MinX: 0, MaxX: 10, MinZ: 0, MaxZ: 2},   // north strip
		{MinX: 0, MaxX: 2, MinZ: 2, MaxZ: 10},   // west strip below it
		{MinX: 4, MaxX: 6, MinZ: -7, MaxZ: 0},   // crossing north off the strip
		{MinX: 8, MaxX: 12, MinZ: 1, MaxZ: 1.5}, // overlaps the strip's east end
	})
	contains := []struct {
		p    Point
		want bool
	}{
		{Point{5, 1}, true},
		{Point{1, 9}, true},
		{Point{5, -3}, true},
		{Point{11, 1.2}, true},
		{Point{3, 3}, false},
		{Point{7, -1}, false},
		{Point{11, 1.8}, false},
	}
	for _, tc := range contains {
		if got := u.contains(tc.p); got != tc.want {
			t.Errorf("contains(%v) = %v, want %v", tc.p, got, tc.want)
		}
	}
	edge := []struct {
		p    Point
		want float64
	}{
		{Point{1, 2}, 1}, // on the shared edge: west kerb is 1 away
		{Point{5, 0}, 1}, // mouth of the crossing: its sides are 1 away
		{Point{5, 1}, 1}, // south kerb of the strip
		{Point{3, 1}, 1}, // north kerb 1 away, reflex corner sqrt(2)
		{Point{2.5, 1.5}, 0.5},
		{Point{9, 1.25}, 0.75}, // inside the overlap, strip's south edge
	}
	for _, tc := range edge {
		if got := u.edgeDist(tc.p); !near(got, tc.want) {
			t.Errorf("edgeDist(%v) = %v, want %v", tc.p, got, tc.want)
		}
	}
	segs := []struct {
		a, b Point
		want bool
	}{
		{Point{1, 9}, Point{9, 1}, false}, // cuts the corner
		{Point{1, 9}, Point{1, 1}, true},
		{Point{1, 1}, Point{9, 1}, true},
		{Point{5, -6}, Point{5, 1.5}, true}, // across the crossing into the strip
		{Point{5, -6}, Point{7, 1.5}, false},
		{Point{9, 1.2}, Point{11.9, 1.2}, true},
		{Point{3, 3}, Point{3, 3}, false},
	}
	for _, tc := range segs {
		if got := u.containsSeg(tc.a, tc.b); got != tc.want {
			t.Errorf("containsSeg(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestObstacles(t *testing.T) {
	o := obstacles{
		discs: []Disc{{X: 0, Z: 0, R: 0.5}},
		boxes: []Rect{{MinX: 3, MaxX: 4, MinZ: -1, MaxZ: 1}},
	}
	tests := []struct {
		name string
		got  float64
		want float64
	}{
		{"near disc", o.dist(Point{0, 2}), 1.5},
		{"inside disc", o.dist(Point{0.1, 0}), 0},
		{"near box", o.dist(Point{2.5, 0}), 0.5},
		{"segment past disc", o.segDist(Point{-2, 1}, Point{2, 1}), 0.5},
		{"segment into box", o.segDist(Point{2, 0}, Point{3.5, 0}), 0},
		{"segment between", o.segDist(Point{1.5, -2}, Point{1.5, 2}), 1},
	}
	for _, tc := range tests {
		if !near(tc.got, tc.want) {
			t.Errorf("%s = %v, want %v", tc.name, tc.got, tc.want)
		}
	}
}

func TestQuantise(t *testing.T) {
	tests := []struct{ in, want float64 }{
		{1.0000004, 1},
		{1.0000006, 1.000001},
		{-2.5000004, -2.5},
		{51.95, 51.95},
	}
	for _, tc := range tests {
		if got := quantise(tc.in); got != tc.want {
			t.Errorf("quantise(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestNodeIndex(t *testing.T) {
	pts := []Point{{0, 0}, {1, 0}, {5, 5}, {-3, 2}, {0.5, 0.5}}
	ix := newNodeIndex(Rect{MinX: -5, MaxX: 6, MinZ: -5, MaxZ: 6}, 2)
	for i, p := range pts {
		ix.add(int32(i), p)
	}
	ix.remove(4, pts[4])
	got := ix.within(Point{0, 0}, 1.5, pts, nil)
	want := []int32{0, 1}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("within = %v, want %v", got, want)
	}
	// Points outside the indexed bounds still land in the edge buckets.
	ix.add(5, Point{40, 40})
	pts = append(pts, Point{40, 40})
	if got := ix.within(Point{39, 39}, 2, pts, nil); len(got) != 1 || got[0] != 5 {
		t.Errorf("within far = %v, want [5]", got)
	}
}

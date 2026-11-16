package sim

import "testing"

func TestNewRNGDeterministic(t *testing.T) {
	a, b, c := NewRNG(7), NewRNG(7), NewRNG(8)
	x, y, z := a.Uint64(), b.Uint64(), c.Uint64()
	if x != y {
		t.Fatalf("same seed gave %d and %d", x, y)
	}
	if x == z {
		t.Fatalf("different seeds gave the same first value %d", x)
	}
}

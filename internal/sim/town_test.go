package sim

import (
	"bytes"
	"encoding/json"
	"math/rand/v2"
	"testing"
)

const testSeeds = 200

func townFor(seed uint64) Town {
	return NewTown(rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)))
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestNewTownDeterministic(t *testing.T) {
	for seed := uint64(0); seed < 20; seed++ {
		a, b := mustJSON(t, townFor(seed)), mustJSON(t, townFor(seed))
		if !bytes.Equal(a, b) {
			t.Fatalf("seed %d: two runs differ", seed)
		}
		if bytes.Equal(a, mustJSON(t, townFor(seed+1000))) {
			t.Fatalf("seed %d and %d give the same town", seed, seed+1000)
		}
	}
}

func TestBlobJSONShape(t *testing.T) {
	var raw map[string]any
	if err := json.Unmarshal(mustJSON(t, townFor(1).Blobs[0]), &raw); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"id", "name", "shape", "age", "traits", "perception", "interest", "emotions", "familyId", "homeId", "neighbourhoodId"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("blob JSON missing %q", k)
		}
	}
}

func hasTag(b Blob, tag Trait) bool {
	for _, t := range b.Traits {
		if t == tag {
			return true
		}
	}
	return false
}

func ageGroup(age int) string {
	switch {
	case age < AdultMinAge:
		return "child"
	case age < ElderMinAge:
		return "adult"
	default:
		return "elder"
	}
}

// Each invariant is checked over many seeds.
func TestNewTownInvariants(t *testing.T) {
	tests := []struct {
		name  string
		check func(t *testing.T, town Town)
	}{
		{"count, ids, names", func(t *testing.T, town Town) {
			if len(town.Blobs) != TownSize {
				t.Fatalf("got %d blobs", len(town.Blobs))
			}
			names := map[string]bool{}
			for i, b := range town.Blobs {
				if b.ID != i {
					t.Errorf("blob %d has id %d", i, b.ID)
				}
				if b.Name == "" || names[b.Name] {
					t.Errorf("bad or duplicate name %q", b.Name)
				}
				names[b.Name] = true
			}
		}},
		{"personality tags", func(t *testing.T, town Town) {
			for _, b := range town.Blobs {
				n := 0
				for _, c := range Categories {
					k := 0
					if hasTag(b, c.Low) {
						k++
					}
					if hasTag(b, c.High) {
						k++
					}
					if k > 1 {
						t.Errorf("blob %d has both tags in %s", b.ID, c.Name)
					}
					n += k
				}
				if n < 1 || n > 3 {
					t.Errorf("blob %d has %d personality tags", b.ID, n)
				}
			}
		}},
		{"age counts", func(t *testing.T, town Town) {
			got := map[string]int{}
			for _, b := range town.Blobs {
				if b.Age < 0 || b.Age > ElderMaxAge {
					t.Errorf("blob %d age %d out of range", b.ID, b.Age)
				}
				got[ageGroup(b.Age)]++
			}
			want := map[string]int{"child": ChildCount, "adult": AdultCount, "elder": ElderCount}
			for k, v := range want {
				if got[k] != v {
					t.Errorf("%s: got %d want %d", k, got[k], v)
				}
			}
		}},
		{"shape counts", func(t *testing.T, town Town) {
			got := map[Shape]int{}
			for _, b := range town.Blobs {
				got[b.Shape]++
			}
			for i, s := range Shapes {
				if got[s] != ShapeCounts[i] {
					t.Errorf("%s: got %d want %d", s, got[s], ShapeCounts[i])
				}
			}
		}},
		{"families", func(t *testing.T, town Town) {
			if len(town.Families) != FamilyCount {
				t.Fatalf("got %d families", len(town.Families))
			}
			inFamily := 0
			for _, f := range town.Families {
				shape := town.Blobs[f.Parents[0]].Shape
				if len(f.Parents) < 1 || len(f.Parents) > 2 || len(f.Children) < 1 || len(f.Children) > 3 {
					t.Errorf("family %d sizes %d/%d", f.ID, len(f.Parents), len(f.Children))
				}
				for _, p := range f.Parents {
					pb := town.Blobs[p]
					if ageGroup(pb.Age) != "adult" {
						t.Errorf("family %d parent %d age %d", f.ID, p, pb.Age)
					}
					for _, c := range f.Children {
						if pb.Age-town.Blobs[c].Age < ParentMinAgeGap {
							t.Errorf("family %d parent %d too young for child %d", f.ID, p, c)
						}
					}
				}
				for _, c := range f.Children {
					if ageGroup(town.Blobs[c].Age) != "child" {
						t.Errorf("family %d child %d is not a child", f.ID, c)
					}
				}
				for _, m := range append(append([]int{}, f.Parents...), f.Children...) {
					b := town.Blobs[m]
					inFamily++
					if b.Shape != shape || b.FamilyID != f.ID || b.HomeID != f.HomeID || !hasTag(b, TraitFamilyOriented) {
						t.Errorf("family %d member %d inconsistent", f.ID, m)
					}
				}
			}
			for _, b := range town.Blobs {
				if (b.FamilyID == NoFamily) == hasTag(b, TraitFamilyOriented) {
					t.Errorf("blob %d family tag mismatch", b.ID)
				}
				if ageGroup(b.Age) == "child" && b.FamilyID == NoFamily {
					t.Errorf("child %d without family", b.ID)
				}
			}
			if inFamily != FamilyBlobCount {
				t.Errorf("got %d blobs in families", inFamily)
			}
		}},
		{"leaders", func(t *testing.T, town Town) {
			per := map[Shape]int{}
			for _, b := range town.Blobs {
				if !hasTag(b, TraitLeader) {
					continue
				}
				per[b.Shape]++
				if ageGroup(b.Age) == "child" || !hasTag(b, TraitCharismatic) || hasTag(b, TraitRecluse) {
					t.Errorf("bad leader %+v", b)
				}
			}
			for _, s := range Shapes {
				if per[s] != 1 {
					t.Errorf("%s has %d leaders", s, per[s])
				}
			}
		}},
		{"recluses", func(t *testing.T, town Town) {
			n := 0
			for _, b := range town.Blobs {
				if !hasTag(b, TraitRecluse) {
					continue
				}
				n++
				if b.FamilyID != NoFamily || ageGroup(b.Age) == "child" || len(town.Homes[b.HomeID].Residents) != 1 {
					t.Errorf("bad recluse %+v", b)
				}
			}
			if n != RecluseCount {
				t.Errorf("got %d recluses", n)
			}
		}},
		{"homes and neighbourhoods", func(t *testing.T, town Town) {
			if len(town.Homes) != HomeCount {
				t.Fatalf("got %d homes", len(town.Homes))
			}
			sizes := map[int]int{}
			perHood := make([]int, NeighbourhoodCount)
			seen := 0
			for i, h := range town.Homes {
				if h.ID != i {
					t.Errorf("home %d has id %d", i, h.ID)
				}
				if h.FamilyID == NoFamily {
					sizes[len(h.Residents)]++
				}
				perHood[h.NeighbourhoodID]++
				for _, r := range h.Residents {
					seen++
					b := town.Blobs[r]
					if b.HomeID != h.ID || b.NeighbourhoodID != h.NeighbourhoodID {
						t.Errorf("blob %d home mismatch", r)
					}
				}
			}
			if seen != TownSize {
				t.Errorf("homes hold %d blobs", seen)
			}
			if sizes[1] != OnePersonHomes || sizes[2] != TwoPersonHomes {
				t.Errorf("non-family home sizes %v", sizes)
			}
			for i, n := range perHood {
				want := HomeCount / NeighbourhoodCount
				if i < HomeCount%NeighbourhoodCount {
					want++
				}
				if n != want {
					t.Errorf("neighbourhood %d has %d homes, want %d", i, n, want)
				}
			}
		}},
		{"starting scores", func(t *testing.T, town Town) {
			for _, b := range town.Blobs {
				if b.Perception != StartPerception || b.Interest != StartInterest {
					t.Errorf("blob %d starts %d/%d", b.ID, b.Perception, b.Interest)
				}
			}
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for seed := uint64(0); seed < testSeeds; seed++ {
				tc.check(t, townFor(seed))
				if t.Failed() {
					t.Fatalf("failed at seed %d", seed)
				}
			}
		})
	}
}

func TestNamesList(t *testing.T) {
	seen := map[string]bool{}
	for _, n := range names {
		if seen[n] {
			t.Errorf("duplicate name %q", n)
		}
		seen[n] = true
	}
	if len(names) < TownSize {
		t.Fatalf("only %d names", len(names))
	}
}

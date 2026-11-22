package sim

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
)

// runFor plays rounds with one story of strength claimed seeded before round 0.
func runFor(seed uint64, rounds int, claimed float64) RunLog {
	rng := NewRNG(seed)
	town := NewTown(rng)
	st := NewState(town, StubBrain{})
	log := NewRunLog(seed, town)
	st.announce(claimed, rng)
	for range rounds {
		log.Rounds = append(log.Rounds, st.Step(rng))
	}
	return log
}

func TestRunLogDeterministic(t *testing.T) {
	for _, seed := range []uint64{1, 2, 42} {
		a, _ := json.Marshal(runFor(seed, 50, 50))
		b, _ := json.Marshal(runFor(seed, 50, 50))
		if !bytes.Equal(a, b) {
			t.Fatalf("seed %d: RunLog JSON differs", seed)
		}
	}
}

func TestScoresInRange(t *testing.T) {
	for seed := uint64(0); seed < 30; seed++ {
		for _, claimed := range []float64{0, 50, 100} {
			st := NewState(NewTown(NewRNG(seed)), StubBrain{})
			rng := NewRNG(seed + 1000)
			for r := range 50 {
				if r%10 == 0 {
					st.announce(claimed, rng)
				}
				round := st.Step(rng)
				for i := range round.Perception {
					p, in := round.Perception[i], round.Interest[i]
					if p < 0 || p > 100 || in < 0 || in > 100 {
						t.Fatalf("seed %d round %d blob %d: p=%v i=%v", seed, r, i, p, in)
					}
				}
				for _, e := range round.Events {
					if e.Claim < 0 || e.Claim > 100 {
						t.Fatalf("claim out of range: %v", e.Claim)
					}
				}
			}
		}
	}
}

func TestActionRules(t *testing.T) {
	talks, posts := map[Trait]int{}, map[Trait]int{}
	counts := map[Trait]int{}
	for seed := uint64(1); seed <= 20; seed++ {
		log := runFor(seed, 50, 60)
		// re-seed a story every 10 rounds via a fresh run for richer data
		st := NewState(log.Town, StubBrain{})
		rng := NewRNG(seed + 500)
		for _, b := range log.Town.Blobs {
			for _, tag := range []Trait{TraitQuiet, TraitChatty} {
				if hasTag(b, tag) {
					counts[tag]++
				}
			}
		}
		for r := range 50 {
			if r%10 == 0 {
				st.announce(60, rng)
			}
			for _, e := range st.Step(rng).Events {
				b := log.Town.Blobs[e.From]
				if !e.Post && hasTag(b, TraitRecluse) {
					t.Fatalf("recluse %d talked in person", b.ID)
				}
				if e.Post && b.Age < 13 {
					t.Fatalf("under-13 %d posted", b.ID)
				}
				if !e.Post {
					if len(e.To) != 1 || hasTag(log.Town.Blobs[e.To[0]], TraitRecluse) || e.To[0] == e.From {
						t.Fatalf("bad talk partner %v", e)
					}
				} else if len(e.To) != PostReaders {
					t.Fatalf("post reached %d", len(e.To))
				}
				for _, tag := range []Trait{TraitQuiet, TraitChatty} {
					if hasTag(b, tag) {
						if e.Post {
							posts[tag]++
						} else {
							talks[tag]++
						}
					}
				}
			}
		}
	}
	rate := func(tag Trait) float64 { return float64(talks[tag]+posts[tag]) / float64(counts[tag]) }
	if rate(TraitChatty) < 1.5*rate(TraitQuiet) {
		t.Fatalf("chatty rate %.2f not well above quiet %.2f", rate(TraitChatty), rate(TraitQuiet))
	}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// MODEL.md#worked-example, steps 1–6. Steps 7–8 (shipping) belong to #15.
func TestWorkedExample(t *testing.T) {
	ada := Blob{ID: 0, Shape: ShapeSquare, Age: 40, Traits: []Trait{TraitCharismatic}, FamilyID: NoFamily, HomeID: 0, NeighbourhoodID: 0}
	bo := Blob{ID: 1, Shape: ShapeSquare, Age: 30, Traits: []Trait{TraitGullible}, FamilyID: NoFamily, HomeID: 1, NeighbourhoodID: 1}
	st := NewState(Town{Blobs: []Blob{ada, bo}}, StubBrain{})
	st.blobs[0] = blobState{perception: 60, interest: 40, heard: 90, hasHeard: true, sources: map[int]bool{-1: true}}
	st.blobs[1] = blobState{perception: 50, interest: 20, heard: 88, hasHeard: true, sources: map[int]bool{7: true}}

	if p := st.pActive(0); !near(p, 0.40) {
		t.Fatalf("pActive = %v, want 0.40", p)
	}
	told := StubBrain{}.Retell(Retelling{Teller: 0, Listener: 1, TellerPerception: 60, Heard: 90, Channel: ChannelTalk})
	if !near(told.Strength, 94) {
		t.Fatalf("c_told = %v, want 94", told.Strength)
	}
	cases := []struct {
		name      string
		got, want float64
	}{
		{"tone", retellTone(60, 94), 78.5},
		{"k", st.k(1, 0, ChannelTalk), 4.5},
	}
	for _, c := range cases {
		if !near(c.got, c.want) {
			t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
		}
	}
	st.hear(1, 0, 94, 78.5, ChannelTalk)
	b := st.blobs[1]
	for _, c := range []struct {
		name      string
		got, want float64
	}{{"interest", b.interest, 46.64}, {"perception", b.perception, 60.26}, {"heard", b.heard, 91}} {
		if !near(c.got, c.want) {
			t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
		}
	}
}

func TestTrust(t *testing.T) {
	// parent 0 (adult star leader), child 1 (star), elder 2 (triangle, age 70), tear 3, capsule 4
	town := Town{
		Blobs: []Blob{
			{ID: 0, Shape: ShapeStar, Age: 40, Traits: []Trait{TraitLeader}, FamilyID: 0, NeighbourhoodID: 0},
			{ID: 1, Shape: ShapeStar, Age: 10, FamilyID: 0, NeighbourhoodID: 0},
			{ID: 2, Shape: ShapeTriangle, Age: 70, FamilyID: NoFamily, NeighbourhoodID: 1},
			{ID: 3, Shape: ShapeTear, Age: 35, FamilyID: NoFamily, NeighbourhoodID: 1},
			{ID: 4, Shape: ShapeCapsule, Age: 35, FamilyID: NoFamily, NeighbourhoodID: 2},
			{ID: 5, Shape: ShapeStar, Age: 30, FamilyID: NoFamily, NeighbourhoodID: 2},
		},
		Families: []Family{{ID: 0, Parents: []int{0}, Children: []int{1}}},
	}
	st := NewState(town, StubBrain{})
	cases := []struct {
		l, s int
		want float64
	}{
		{1, 0, 3.0},  // star child hearing own leader parent: 3×2 clamped to 3
		{5, 0, 3.0},  // star hearing own leader
		{5, 1, 1.0},  // star hearing own shape
		{0, 3, 0.80}, // star hearing other shape
		{2, 3, 0.75 * 1.2},
		{2, 4, 0.75 * 1.2},
		{3, 2, 2.0},  // tear same hood
		{3, 4, 0.75}, // tear other hood
		{4, 3, 0.80}, // capsule not family
		{1, -1, 1.0},
	}
	for _, c := range cases {
		if got := st.trust(c.l, c.s); !near(got, c.want) {
			t.Errorf("trust(%d,%d) = %v, want %v", c.l, c.s, got, c.want)
		}
	}
}

func TestRepeat(t *testing.T) {
	cases := []struct {
		sources map[int]bool
		s       int
		want    float64
	}{
		{map[int]bool{}, 3, 1.0},
		{map[int]bool{3: true}, 3, 0.5},
		{map[int]bool{1: true}, 3, 1.0},
		{map[int]bool{1: true, 2: true}, 3, 1.25},
		{map[int]bool{1: true, 2: true, 4: true, 5: true, 6: true, 7: true, 8: true}, 3, 2.0},
	}
	for i, c := range cases {
		if got := repeat(c.sources, c.s); !near(got, c.want) {
			t.Errorf("case %d: %v, want %v", i, got, c.want)
		}
	}
}

func TestStubDrift(t *testing.T) {
	cases := []struct {
		heard, perc float64
		ch          Channel
		want        float64
	}{
		{90, 60, ChannelTalk, 94},
		{50, 0, ChannelTalk, 48},
		{50, 100, ChannelPost, 60},
		{99, 100, ChannelPost, 100},
		{1, 0, ChannelTalk, 0},
	}
	for _, c := range cases {
		got := StubBrain{}.Retell(Retelling{Heard: c.heard, TellerPerception: c.perc, Channel: c.ch}).Strength
		if !near(got, c.want) {
			t.Errorf("%+v: %v", c, got)
		}
	}
}

func TestNoEligiblePartnerIdles(t *testing.T) {
	town := Town{Blobs: []Blob{
		{ID: 0, Age: 8, Shape: ShapeCircle, FamilyID: NoFamily, HomeID: 0},
		{ID: 1, Age: 40, Shape: ShapeCircle, Traits: []Trait{TraitRecluse}, FamilyID: NoFamily, HomeID: 1},
	}}
	st := NewState(town, StubBrain{})
	st.blobs[0] = blobState{perception: 100, interest: 100, heard: 50, hasHeard: true, sources: map[int]bool{-1: true}}
	rng := NewRNG(1)
	for range 50 {
		for _, e := range st.Step(rng).Events {
			if e.From == 0 {
				t.Fatalf("blob with no partner acted: %+v", e)
			}
		}
	}
}

func TestDecay(t *testing.T) {
	town := Town{Blobs: []Blob{{ID: 0, Shape: ShapeCircle, Age: 30, FamilyID: NoFamily, Interest: 50, Perception: 50}}}
	r := NewState(town, StubBrain{}).Step(NewRNG(1))
	if r.Interest[0] != 48.8 || r.Perception[0] != 50 { // MODEL.md#decay: 50 + 0.03×(10−50)
		t.Fatalf("got interest %v perception %v", r.Interest[0], r.Perception[0])
	}
}

func TestAnnounceReachesLeaders(t *testing.T) {
	for seed := uint64(1); seed <= 20; seed++ {
		rng := NewRNG(seed)
		st := NewState(NewTown(rng), StubBrain{})
		st.announce(50, rng)
		for i, b := range st.Town.Blobs {
			if hasTag(b, TraitLeader) && (!st.blobs[i].hasHeard || !st.blobs[i].sources[CompanyID]) {
				t.Fatalf("seed %d: leader %d not reached", seed, i)
			}
		}
	}
}

func TestEventSlicesNeverNull(t *testing.T) {
	// A post in a 1-blob town has 0 readers.
	town := Town{Blobs: []Blob{{ID: 0, Age: 40, Shape: ShapeCircle, Traits: []Trait{TraitRecluse}, FamilyID: NoFamily}}}
	st := NewState(town, StubBrain{})
	st.blobs[0] = blobState{perception: 100, interest: 100, heard: 50, hasHeard: true, sources: map[int]bool{}}
	rng := NewRNG(1)
	for range 20 {
		for _, e := range st.Step(rng).Events {
			j, _ := json.Marshal(e)
			if bytes.Contains(j, []byte("null")) {
				t.Fatalf("null in %s", j)
			}
		}
	}
}

func TestMaxSeed(t *testing.T) {
	if MaxSeed != 1<<53-1 || float64(MaxSeed) != 9007199254740991 {
		t.Fatalf("MaxSeed = %d", uint64(MaxSeed))
	}
}

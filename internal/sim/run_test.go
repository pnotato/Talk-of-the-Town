package sim

import (
	"bytes"
	"encoding/json"
	"math"
	"slices"
	"testing"

	"talkofthetown/internal/sim/content"
)

var (
	allHonest = []string{"m0-honest", "m1-honest", "m2-honest", "m3-honest", "m4-honest"}
	allBold   = []string{"m0-bold", "m1-bold", "m2-bold", "m3-bold", "m4-bold"}
)

func mustRun(t *testing.T, seed uint64, choices []string) RunLog {
	t.Helper()
	l, err := Run(seed, choices, StubBrain{})
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func TestRunDeterministic(t *testing.T) {
	for _, seed := range []uint64{1, 7, MaxSeed} {
		a, _ := json.Marshal(mustRun(t, seed, allBold))
		b, _ := json.Marshal(mustRun(t, seed, allBold))
		if !bytes.Equal(a, b) {
			t.Fatalf("seed %d: RunLog JSON differs", seed)
		}
	}
}

func TestRunInvalidChoices(t *testing.T) {
	for name, c := range map[string][]string{
		"unknown":      {"nope"},
		"wrong moment": {"m1-honest"},
		"too many":     append(append([]string{}, allHonest...), "m4-honest"),
	} {
		if _, err := Run(1, c, StubBrain{}); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func TestRunPartial(t *testing.T) {
	for n := 0; n <= 5; n++ {
		l := mustRun(t, 3, allHonest[:n])
		if len(l.Rounds) != n*10 || len(l.Moments) != n {
			t.Fatalf("n=%d: %d rounds, %d moments", n, len(l.Rounds), len(l.Moments))
		}
		if n == 5 {
			if l.Next != nil {
				t.Fatal("finished run has Next")
			}
		} else if l.Next == nil || l.Next.Round != n*10 || len(l.Next.Options) == 0 {
			t.Fatalf("n=%d: Next = %+v", n, l.Next)
		}
		if l.Label != "SIMULATED" || l.Company == "" {
			t.Fatalf("label %q company %q", l.Label, l.Company)
		}
	}
	// A partial run is a prefix of the full one.
	a, _ := json.Marshal(mustRun(t, 3, allHonest[:2]).Rounds)
	b, _ := json.Marshal(mustRun(t, 3, allHonest).Rounds[:20])
	if !bytes.Equal(a, b) {
		t.Fatal("partial run is not a prefix of the full run")
	}
	a, _ = json.Marshal(mustRun(t, 3, allHonest[:2]).Moments)
	b, _ = json.Marshal(mustRun(t, 3, allHonest).Moments[:2])
	if !bytes.Equal(a, b) {
		t.Fatal("partial moments are not a prefix of the full run")
	}
}

func TestRunMomentsShipAndBreak(t *testing.T) {
	l := mustRun(t, 1, allBold)
	for k, m := range l.Moments {
		if !m.Shipped || !m.Broken {
			t.Fatalf("moment %d: %+v", k, m)
		}
	}
	if c := l.Moments[4].Credibility; !near(c, 0.32768) {
		t.Fatalf("credibility after 5 broken = %v", c)
	}
	if mustRun(t, 1, allHonest).Moments[4].Credibility != 1 {
		t.Fatal("honest run lost credibility")
	}
}

// Bold beats honest on interest before the ship, then loses on perception after it.
func TestBoldVersusHonest(t *testing.T) {
	var bi, hi, bp, hp float64
	for seed := uint64(1); seed <= 10; seed++ {
		b, h := mustRun(t, seed, allBold[:1]), mustRun(t, seed, allHonest[:1])
		bi += b.Rounds[7].AvgInterest
		hi += h.Rounds[7].AvgInterest
		bp += b.Rounds[9].AvgPerception
		hp += h.Rounds[9].AvgPerception
	}
	if bi <= hi {
		t.Errorf("round 7 interest: bold %v <= honest %v", bi/10, hi/10)
	}
	if bp >= hp {
		t.Errorf("round 9 perception: bold %v >= honest %v", bp/10, hp/10)
	}
}

// MODEL.md#worked-example steps 7–8.
func TestShipWorkedExample(t *testing.T) {
	st := NewState(Town{Blobs: []Blob{{ID: 0, FamilyID: NoFamily}}}, StubBrain{})
	st.blobs[0] = blobState{perception: 60.3, interest: 46.6, heard: 91, hasHeard: true, sources: map[int]bool{}}
	st.ship(90, 50)
	b := st.blobs[0]
	if !near(b.perception, 39.8) || !near(b.interest, 47.62) {
		t.Fatalf("p=%v i=%v, want 39.8, 47.62", b.perception, b.interest)
	}
	if st.Broken != 1 || !near(st.Credibility, 0.80) {
		t.Fatalf("broken=%d cred=%v", st.Broken, st.Credibility)
	}
}

func TestShipTable(t *testing.T) {
	for _, c := range []struct {
		name               string
		heard              float64
		hasHeard           bool
		claimed, delivered float64
		wantP, wantI       float64
		wantBroken         int
	}{
		{"gain, heard", 40, true, 50, 60, 50 + 0.25*20, 20 + 0.3*40, 0},
		{"unheard, half weight", 0, false, 70, 50, 50 - 0.5*0.25*2*20, 20 + 0.3*30, 1},
		{"exactly 15 not broken", 0, false, 65, 50, 50 - 0.5*0.25*2*15, 20 + 0.3*30, 0},
		{"clamped at 0", 100, true, 100, 0, 0, 20 - 0.3*20, 1},
	} {
		st := NewState(Town{Blobs: []Blob{{ID: 0, FamilyID: NoFamily}}}, StubBrain{})
		st.blobs[0] = blobState{perception: 50, interest: 20, heard: c.heard, hasHeard: c.hasHeard, sources: map[int]bool{}}
		st.ship(c.claimed, c.delivered)
		if b := st.blobs[0]; !near(b.perception, c.wantP) || !near(b.interest, c.wantI) || st.Broken != c.wantBroken {
			t.Errorf("%s: p=%v i=%v broken=%d", c.name, b.perception, b.interest, st.Broken)
		}
	}
}

func TestCredibilityFloor(t *testing.T) {
	st := NewState(Town{}, StubBrain{})
	for range 10 {
		st.ship(100, 0)
	}
	if st.Credibility != CredFloor {
		t.Fatalf("cred = %v", st.Credibility)
	}
}

func TestShipRounds(t *testing.T) {
	for k, m := range mustRun(t, 2, allBold).Moments {
		if m.ShippedRound != k*10+8 {
			t.Fatalf("moment %d shipped at %d", k, m.ShippedRound)
		}
	}
	if m := mustRun(t, 2, allBold[:1]).Moments[0]; !m.Shipped || m.ShippedRound != 8 {
		t.Fatalf("%+v", m)
	}
}

// The bold ship lands at round 8: perception drops between Rounds[7] and Rounds[8].
func TestBoldShipDropsAtRound8(t *testing.T) {
	var drop7, drop8 float64
	for seed := uint64(1); seed <= 5; seed++ {
		r := mustRun(t, seed, allBold[:1]).Rounds
		drop7 += r[6].AvgPerception - r[7].AvgPerception
		drop8 += r[7].AvgPerception - r[8].AvgPerception
	}
	if drop8 < 5*5 || drop8 <= drop7 {
		t.Fatalf("mean drop r7->r8 = %v, r6->r7 = %v", drop8/5, drop7/5)
	}
}

func TestRunRejectsBadContent(t *testing.T) {
	good, err := content.LoadAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	noLabel, short := good, good
	noLabel.Label = "REAL"
	short.Moments = good.Moments[:2]
	for name, a := range map[string]content.Announcements{"label": noLabel, "few moments": short} {
		if _, err := run(a, cityGraph(t), 1, allHonest[:2], StubBrain{}); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

// TestMovementFieldsNeverNull: the client reads map, start and paths as
// arrays, even before a round is played.
func TestMovementFieldsNeverNull(t *testing.T) {
	town := NewTown(NewRNG(1))
	for name, v := range map[string]any{
		"NewRunLog":    NewRunLog(1, town),
		"Step":         NewState(town, StubBrain{}).Step(NewRNG(1)),
		"0-choice run": mustRun(t, 1, nil),
	} {
		j, _ := json.Marshal(v)
		for _, key := range []string{`"map":null`, `"nodes":null`, `"start":null`, `"paths":null`} {
			if bytes.Contains(j, []byte(key)) {
				t.Errorf("%s has %s", name, key)
			}
		}
	}
	// A 0-choice run plays no round but still places the blobs.
	if l := mustRun(t, 1, nil); len(l.Start) != len(l.Town.Blobs) || len(l.Map.Nodes) == 0 {
		t.Fatalf("0-choice run: %d starts, %d map nodes", len(l.Start), len(l.Map.Nodes))
	}
}

// TestCityWalkLiveness runs the run's walker on the real city for a whole
// run and counts goals reached. It also ends where Run's paths end, so it
// is the same walk.
func TestCityWalkLiveness(t *testing.T) {
	g := cityGraph(t)
	const ticks = RunRounds * TicksPerRound
	lo, sum, n, regoals := math.MaxInt, 0, 0, 0
	for seed := uint64(1); seed <= 10; seed++ {
		w := mustWalker(t, g, TownSize, seed)
		st := watch(t, w, ticks)
		regoals += st.regoals
		last := mustRun(t, seed, allHonest).Rounds[RunRounds-1].Paths
		for b, p := range last {
			if p[TicksPerRound] != w.at[b] {
				t.Fatalf("seed %d blob %d: walker ends on %d, Run on %d", seed, b, w.at[b], p[TicksPerRound])
			}
		}
		for _, a := range st.arrivals {
			sum += a
			n++
		}
		lo = min(lo, slices.Min(st.arrivals))
	}
	t.Logf("goals per blob over a %d-tick run, seeds 1-10: min %d, mean %.1f; %.1f stuck walkers re-goaled per run",
		ticks, lo, float64(sum)/float64(n), float64(regoals)/10)
	if lo < cityMinGoals {
		t.Fatalf("a blob reached only %d goals in a run, want >= %d", lo, cityMinGoals)
	}
}

// cityMinGoals: every blob should finish a couple of walks per run. A walk
// takes at most WanderMaxHops plus DwellMaxTicks unhindered, so 500 ticks
// fit 15.
const cityMinGoals = 2

// BenchmarkRun is a full run; the city graph is built once, before timing.
func BenchmarkRun(b *testing.B) {
	cityGraph(b)
	for b.Loop() {
		if _, err := Run(1, allBold, StubBrain{}); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkCityWalk is the movement alone for a full run.
func BenchmarkCityWalk(b *testing.B) {
	g := cityGraph(b)
	for b.Loop() {
		w := mustWalker(b, g, TownSize, 1)
		for range RunRounds {
			w.round(TicksPerRound)
		}
	}
}

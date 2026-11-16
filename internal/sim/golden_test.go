package sim

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"reflect"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files in testdata/")

const (
	goldenSeed = 20261116
	goldenPath = "testdata/golden_run.json"
)

// goldenChoices mixes honest and bold so both ship paths (kept and broken
// promises) are covered.
var goldenChoices = []string{"m0-honest", "m1-bold", "m2-honest", "m3-bold", "m4-upbeat"}

// goldenBytes encodes the golden run as compact JSON with one blob, round or
// moment per line: about 210 KB (indented JSON is 500 KB) and a git diff
// still points at the round that changed.
func goldenBytes(t *testing.T) []byte {
	t.Helper()
	l := mustRun(t, goldenSeed, goldenChoices)
	var b bytes.Buffer
	enc := func(v any) {
		j, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		b.Write(j)
	}
	list := func(key string, n int, at func(int) any) {
		fmt.Fprintf(&b, "%q:[", key)
		for i := range n {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString("\n")
			enc(at(i))
		}
		b.WriteString("\n]")
	}
	fmt.Fprintf(&b, `{"label":%q,"company":%q,"seed":%d,"town":{`, l.Label, l.Company, l.Seed)
	list("blobs", len(l.Town.Blobs), func(i int) any { return l.Town.Blobs[i] })
	b.WriteString(",\n\"families\":")
	enc(l.Town.Families)
	b.WriteString(",\n\"homes\":")
	enc(l.Town.Homes)
	b.WriteString("},\n")
	list("rounds", len(l.Rounds), func(i int) any { return l.Rounds[i] })
	b.WriteString(",\n")
	list("moments", len(l.Moments), func(i int) any { return l.Moments[i] })
	b.WriteString(",\n\"next\":")
	enc(l.Next)
	b.WriteString("}\n")
	// Guard the hand-rolled layout: it must decode to exactly the RunLog.
	var back RunLog
	if err := json.Unmarshal(b.Bytes(), &back); err != nil {
		t.Fatalf("golden encoding is not valid JSON: %v", err)
	}
	if !reflect.DeepEqual(back, l) {
		t.Fatal("golden encoding does not round-trip to the RunLog")
	}
	return b.Bytes()
}

// TestGolden pins a whole run byte-for-byte. Update on purpose only:
//
//	go test ./internal/sim -run Golden -update
func TestGolden(t *testing.T) {
	got := goldenBytes(t)
	if *update {
		if err := os.WriteFile(goldenPath, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("%v (create with -update)", err)
	}
	if bytes.Equal(got, want) {
		return
	}
	var g, w RunLog
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatalf("golden is not a RunLog: %v", err)
	}
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatal(err)
	}
	t.Fatalf("RunLog differs from %s: %s\nIf intended, rerun with -update and explain the diff in the PR.",
		goldenPath, firstDiff(g, w))
}

// firstDiff names the first differing field, round first, so a failure is one line.
func firstDiff(g, w RunLog) string {
	for _, f := range []struct {
		name string
		g, w any
	}{{"label", g.Label, w.Label}, {"company", g.Company, w.Company}, {"seed", g.Seed, w.Seed}} {
		if !reflect.DeepEqual(f.g, f.w) {
			return fmt.Sprintf("%s: got %v, want %v", f.name, f.g, f.w)
		}
	}
	for i := range min(len(g.Town.Blobs), len(w.Town.Blobs)) {
		if !reflect.DeepEqual(g.Town.Blobs[i], w.Town.Blobs[i]) {
			return fmt.Sprintf("town.blobs[%d]: got %+v, want %+v", i, g.Town.Blobs[i], w.Town.Blobs[i])
		}
	}
	if !reflect.DeepEqual(g.Town, w.Town) {
		return "town (families/homes or blob count) differs"
	}
	for i := range min(len(g.Rounds), len(w.Rounds)) {
		a, b := g.Rounds[i], w.Rounds[i]
		switch {
		case len(a.Events) != len(b.Events):
			return fmt.Sprintf("round %d: %d events, want %d", i, len(a.Events), len(b.Events))
		case !reflect.DeepEqual(a.Events, b.Events):
			for j := range a.Events {
				if !reflect.DeepEqual(a.Events[j], b.Events[j]) {
					return fmt.Sprintf("round %d event %d: got %+v, want %+v", i, j, a.Events[j], b.Events[j])
				}
			}
		case a.AvgPerception != b.AvgPerception || a.AvgInterest != b.AvgInterest:
			return fmt.Sprintf("round %d avg: got P=%v I=%v, want P=%v I=%v", i, a.AvgPerception, a.AvgInterest, b.AvgPerception, b.AvgInterest)
		case !reflect.DeepEqual(a, b):
			for k := range min(len(a.Perception), len(b.Perception), len(a.Interest), len(b.Interest)) {
				if a.Perception[k] != b.Perception[k] || a.Interest[k] != b.Interest[k] {
					return fmt.Sprintf("round %d blob %d: got P=%v I=%v, want P=%v I=%v", i, k, a.Perception[k], a.Interest[k], b.Perception[k], b.Interest[k])
				}
			}
			return fmt.Sprintf("round %d differs", i)
		}
	}
	if len(g.Rounds) != len(w.Rounds) {
		return fmt.Sprintf("%d rounds, want %d", len(g.Rounds), len(w.Rounds))
	}
	for i := range min(len(g.Moments), len(w.Moments)) {
		if !reflect.DeepEqual(g.Moments[i], w.Moments[i]) {
			return fmt.Sprintf("moments[%d]: got %+v, want %+v", i, g.Moments[i], w.Moments[i])
		}
	}
	if !reflect.DeepEqual(g, w) {
		return "moments or next differ"
	}
	return "bytes differ but values are equal (JSON encoding changed?)"
}

var strategies = map[string]func(seed uint64) []string{
	"honest": func(uint64) []string { return allHonest },
	"bold":   func(uint64) []string { return allBold },
	"mixed":  func(uint64) []string { return goldenChoices },
	"seeded": func(seed uint64) []string { // alternate by seed bit per moment
		c := make([]string, 5)
		for k := range c {
			if seed>>k&1 == 1 {
				c[k] = allBold[k]
			} else {
				c[k] = allHonest[k]
			}
		}
		return c
	},
}

func TestInvariants(t *testing.T) {
	for seed := uint64(1); seed <= 10; seed++ {
		for name, strat := range strategies {
			choices := strat(seed)
			t.Run(fmt.Sprintf("seed%d/%s", seed, name), func(t *testing.T) {
				l := mustRun(t, seed, choices)
				checkRunLog(t, l, choices)
				a, _ := json.Marshal(l)
				b, _ := json.Marshal(mustRun(t, seed, choices))
				if !bytes.Equal(a, b) {
					t.Fatal("not deterministic: second run gives different bytes")
				}
				checkPrefixes(t, seed, choices, l)
			})
		}
	}
}

func checkRunLog(t *testing.T, l RunLog, choices []string) {
	t.Helper()
	if l.Label != ContentLabel || ContentLabel != "SIMULATED" {
		t.Errorf("label %q, want SIMULATED", l.Label)
	}
	if l.Next != nil {
		t.Errorf("full run has Next = %+v", l.Next)
	}
	if len(l.Rounds) != 50 {
		t.Fatalf("%d rounds, want 50", len(l.Rounds))
	}
	checkTown(t, l.Town)
	if len(l.Moments) != 5 {
		t.Fatalf("%d moments, want 5", len(l.Moments))
	}
	for k, m := range l.Moments {
		if m.Round != 10*k || m.OptionID != choices[k] {
			t.Errorf("moment %d: round %d option %s, want %d %s", k, m.Round, m.OptionID, 10*k, choices[k])
		}
		if !m.Shipped || m.ShippedRound != 10*k+8 {
			t.Errorf("moment %d: shipped=%v at %d, want round %d", k, m.Shipped, m.ShippedRound, 10*k+8)
		}
		if m.Broken != (m.Claimed-m.Delivered > BrokenThreshold) {
			t.Errorf("moment %d: broken=%v for claimed %d delivered %d", k, m.Broken, m.Claimed, m.Delivered)
		}
		if !(m.Credibility >= CredFloor && m.Credibility <= 1) {
			t.Errorf("moment %d: credibility %v", k, m.Credibility)
		}
	}
	for i, r := range l.Rounds {
		if r.Index != i {
			t.Errorf("round %d has index %d", i, r.Index)
		}
		if len(r.Perception) != 100 || len(r.Interest) != 100 {
			t.Fatalf("round %d: %d/%d scores, want 100", i, len(r.Perception), len(r.Interest))
		}
		var sp, si float64
		for b := range 100 {
			score(t, fmt.Sprintf("round %d blob %d perception", i, b), r.Perception[b])
			score(t, fmt.Sprintf("round %d blob %d interest", i, b), r.Interest[b])
			sp += r.Perception[b]
			si += r.Interest[b]
		}
		score(t, fmt.Sprintf("round %d avgPerception", i), r.AvgPerception)
		score(t, fmt.Sprintf("round %d avgInterest", i), r.AvgInterest)
		// Per-blob values and averages are each rounded to 0.1, so allow 0.1.
		if math.Abs(sp/100-r.AvgPerception) > 0.1+1e-9 || math.Abs(si/100-r.AvgInterest) > 0.1+1e-9 {
			t.Errorf("round %d: avg P=%v I=%v, mean of blobs P=%.3f I=%.3f", i, r.AvgPerception, r.AvgInterest, sp/100, si/100)
		}
		for j, e := range r.Events {
			score(t, fmt.Sprintf("round %d event %d claim", i, j), e.Claim)
			if len(e.To) == 0 || len(e.DP) != len(e.To) || len(e.DI) != len(e.To) || (!e.Post && len(e.To) != 1) {
				t.Errorf("round %d event %d malformed: %+v", i, j, e)
			}
			for _, to := range append([]int{e.From}, e.To...) {
				if to < 0 || to >= 100 {
					t.Errorf("round %d event %d: blob id %d", i, j, to)
				}
			}
		}
	}
}

func score(t *testing.T, what string, x float64) {
	t.Helper()
	if math.IsNaN(x) || math.IsInf(x, 0) || x < 0 || x > 100 {
		t.Errorf("%s = %v, want finite in [0,100]", what, x)
	}
}

func checkTown(t *testing.T, town Town) {
	t.Helper()
	if len(town.Blobs) != 100 {
		t.Fatalf("%d blobs, want 100", len(town.Blobs))
	}
	low := map[Trait]int{}
	for c, cat := range Categories {
		low[cat.Low], low[cat.High] = c, c
	}
	special := map[Trait]bool{TraitFamilyOriented: true, TraitRecluse: true, TraitLeader: true}
	shapes, recluses := map[Shape]bool{}, 0
	for _, s := range Shapes {
		shapes[s] = true
	}
	for i, b := range town.Blobs {
		if b.ID != i || b.Name == "" || !shapes[b.Shape] || b.Age < 0 || b.Age > ElderMaxAge {
			t.Errorf("blob %d invalid: %+v", i, b)
		}
		if b.Perception != StartPerception || b.Interest != StartInterest {
			t.Errorf("blob %d starts at P=%d I=%d", i, b.Perception, b.Interest)
		}
		seen, cats := map[Trait]bool{}, map[int]bool{}
		for _, tr := range b.Traits {
			c, ok := low[tr]
			switch {
			case seen[tr]:
				t.Errorf("blob %d: duplicate trait %s", i, tr)
			case ok && cats[c]:
				t.Errorf("blob %d: both tags of %s", i, Categories[c].Name)
			case !ok && !special[tr]:
				t.Errorf("blob %d: unknown trait %q", i, tr)
			}
			seen[tr] = true
			if ok {
				cats[c] = true
			}
		}
		// MODEL.md#tag-count: 1–3 personality tags; specials are extra.
		if len(cats) < 1 || len(cats) > 3 {
			t.Errorf("blob %d has %d personality tags: %v", i, len(cats), b.Traits)
		}
		if seen[TraitLeader] && !seen[TraitCharismatic] {
			t.Errorf("blob %d is a leader but not charismatic", i)
		}
		if seen[TraitRecluse] {
			recluses++
		}
	}
	if recluses != RecluseCount {
		t.Errorf("%d recluses, want %d", recluses, RecluseCount)
	}
}

// checkPrefixes: a run with fewer choices is a prefix of the full run.
func checkPrefixes(t *testing.T, seed uint64, choices []string, full RunLog) {
	t.Helper()
	for n := range len(choices) {
		p := mustRun(t, seed, choices[:n])
		if p.Next == nil || p.Next.Round != 10*n {
			t.Fatalf("%d choices: Next = %+v, want moment at round %d", n, p.Next, 10*n)
		}
		if len(p.Rounds) != 10*n || len(p.Moments) != n {
			t.Fatalf("%d choices: %d rounds, %d moments", n, len(p.Rounds), len(p.Moments))
		}
		pr, _ := json.Marshal(p.Rounds)
		fr, _ := json.Marshal(full.Rounds[:10*n])
		pm, _ := json.Marshal(p.Moments)
		fm, _ := json.Marshal(full.Moments[:n])
		pt, _ := json.Marshal(p.Town)
		ft, _ := json.Marshal(full.Town)
		if !bytes.Equal(pr, fr) || !bytes.Equal(pm, fm) || !bytes.Equal(pt, ft) {
			t.Fatalf("%d choices: not a prefix of the full run", n)
		}
	}
}

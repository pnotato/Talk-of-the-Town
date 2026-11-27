package sim

import (
	"fmt"
	"math"
	"testing"
)

func sum(f feelings) float64 {
	t := 0.0
	for _, x := range f {
		t += x
	}
	return t
}

func checkMix(t *testing.T, what string, f feelings) {
	t.Helper()
	for k, x := range f {
		if math.IsNaN(x) || x < 0 || x > 100 {
			t.Errorf("%s: emotion %d = %v, want 0–100", what, k, x)
		}
	}
	if math.Abs(sum(f)-100) > 1e-9 {
		t.Errorf("%s: shares add up to %v, want 100", what, sum(f))
	}
}

// calmBlob is an average adult circle who has not felt anything yet.
func calmBlob(id int) Blob {
	return Blob{ID: id, Shape: ShapeCircle, Age: 30, FamilyID: NoFamily, Emotions: Emotions{Calm: StartCalm}}
}

func TestBlendKeepsAHundred(t *testing.T) {
	e := calmOnly
	blend(&e, feelings{emoJoy: 100}, 0.4)
	checkMix(t, "after joy", e)
	if !near(e[emoJoy], 40) || !near(e[emoCalm], 60) {
		t.Fatalf("blend = %v, want joy 40 calm 60", e)
	}
}

// caught is how much of feeling k a calm, average blob catches from a speaker who is half calm and
// half k.
func caught(k int) float64 {
	st := NewState(Town{Blobs: []Blob{calmBlob(0), calmBlob(1)}}, StubBrain{})
	var msg feelings
	msg[emoCalm], msg[k] = 50, 50
	st.hear(1, 0, 50, 50, ChannelTalk, msg)
	return st.blobs[1].feel[k]
}

// MODEL.md#emotions: rage spreads fastest, sadness slowest.
func TestAngerSpreadsFasterThanOtherFeelings(t *testing.T) {
	anger := caught(emoAnger)
	for _, k := range []int{emoJoy, emoTrust, emoSurprise, emoFear, emoSadness} {
		if c := caught(k); anger <= c {
			t.Errorf("anger caught %.1f%%, emotion %d %.1f%%; anger should spread fastest", anger, k, c)
		}
	}
	if caught(emoSadness) >= caught(emoJoy) {
		t.Errorf("sadness %.1f%% >= joy %.1f%%; sadness should spread slowest", caught(emoSadness), caught(emoJoy))
	}
}

// Feelings spread but never snowball: nobody catches more of a feeling than the speaker has.
func TestFeelingsNeverOvershootTheSpeaker(t *testing.T) {
	angry := feelings{emoCalm: 20, emoAnger: 80}
	st := NewState(Town{Blobs: []Blob{calmBlob(0), calmBlob(1)}}, StubBrain{})
	for range 50 {
		st.hear(1, 0, 50, 50, ChannelTalk, angry)
		if a := st.blobs[1].feel[emoAnger]; a > 80+1e-9 {
			t.Fatalf("listener anger %v above the speaker's 80", a)
		}
	}
	st.blobs[1].feel = angry
	st.hear(1, 0, 50, 50, ChannelTalk, angry)
	if !near(st.blobs[1].feel[emoAnger], 80) {
		t.Fatalf("two blobs at 80%% anger: listener now %v", st.blobs[1].feel[emoAnger])
	}
}

func TestHearingSpreadsTheSpeakersFeelings(t *testing.T) {
	town := Town{Blobs: []Blob{calmBlob(0), calmBlob(1), calmBlob(2)}}
	st := NewState(town, StubBrain{})
	st.blobs[0].feel = feelings{emoCalm: 20, emoAnger: 80}
	st.hear(1, 0, 50, 50, ChannelTalk, st.blobs[0].feel)
	b := st.blobs[1]
	checkMix(t, "listener", b.feel)
	if b.feel[emoAnger] <= 0 {
		t.Fatalf("listener caught no anger: %v", b.feel)
	}
	// Feelings change no score: the same hearing from a calm speaker moves scores identically.
	st.hear(2, 0, 50, 50, ChannelTalk, calmOnly)
	if b.perception != st.blobs[2].perception || b.interest != st.blobs[2].interest {
		t.Fatalf("feelings changed scores: %+v vs %+v", b, st.blobs[2])
	}
	// The town's credibility does not slow how feelings spread between blobs.
	low := NewState(town, StubBrain{})
	low.Credibility = CredFloor
	low.hear(1, 0, 50, 50, ChannelTalk, st.blobs[0].feel)
	if !near(low.blobs[1].feel[emoAnger], b.feel[emoAnger]) {
		t.Fatalf("credibility changed anger: %v vs %v", low.blobs[1].feel[emoAnger], b.feel[emoAnger])
	}
}

func TestAnnouncementFeelings(t *testing.T) {
	for _, c := range []float64{0, 40, 85, 100} {
		checkMix(t, fmt.Sprintf("claim %v", c), newsFeelings(c))
	}
	honest, bold := newsFeelings(40), newsFeelings(95)
	if bold[emoSurprise] <= honest[emoSurprise] || bold[emoFear] <= honest[emoFear] {
		t.Errorf("bold %v should carry more surprise and fear than honest %v", bold, honest)
	}
	if honest[emoTrust] <= bold[emoTrust] {
		t.Errorf("honest %v should carry more trust than bold %v", honest, bold)
	}
}

func TestShipFeelings(t *testing.T) {
	for _, c := range []struct {
		name             string
		heard            float64
		hasHeard         bool
		claimed, shipped float64
		up, down         []int // emotions that must rise, and fall or stay at 0
	}{
		{"let down", 90, true, 90, 50, []int{emoAnger, emoSadness}, []int{emoJoy, emoTrust}},
		{"pleased", 30, true, 30, 45, []int{emoJoy, emoTrust}, []int{emoAnger, emoSadness}},
		{"unheard bold", 0, false, 90, 50, []int{emoAnger, emoSadness}, []int{emoJoy}},
	} {
		t.Run(c.name, func(t *testing.T) {
			st := NewState(Town{Blobs: []Blob{calmBlob(0)}}, StubBrain{})
			st.blobs[0].heard, st.blobs[0].hasHeard = c.heard, c.hasHeard
			st.ship(c.claimed, c.shipped)
			f := st.blobs[0].feel
			checkMix(t, c.name, f)
			for _, k := range c.up {
				if f[k] <= 0 {
					t.Errorf("emotion %d = %v, want it to rise", k, f[k])
				}
			}
			for _, k := range c.down {
				if f[k] != 0 {
					t.Errorf("emotion %d = %v, want 0", k, f[k])
				}
			}
		})
	}
	// A blob that never heard reacts at half weight.
	heard := NewState(Town{Blobs: []Blob{calmBlob(0)}}, StubBrain{})
	heard.blobs[0].heard, heard.blobs[0].hasHeard = 90, true
	heard.ship(90, 50)
	unheard := NewState(Town{Blobs: []Blob{calmBlob(0)}}, StubBrain{})
	unheard.ship(90, 50)
	if !near(unheard.blobs[0].feel[emoAnger]*2, heard.blobs[0].feel[emoAnger]) {
		t.Errorf("unheard anger %v, heard %v; want half", unheard.blobs[0].feel[emoAnger], heard.blobs[0].feel[emoAnger])
	}
}

func TestFeelingsCalmDown(t *testing.T) {
	st := NewState(Town{Blobs: []Blob{calmBlob(0)}}, StubBrain{})
	st.blobs[0].feel = feelings{emoAnger: 100}
	r := st.Step(NewRNG(1))
	if a := st.blobs[0].feel[emoAnger]; !near(a, 100*(1-FeelDecay)) {
		t.Fatalf("anger after one round %v, want %v", a, 100*(1-FeelDecay))
	}
	if r.Emotions.Anger[0] != math.Round(100*(1-FeelDecay)) || r.Emotions.Calm[0] != math.Round(100*FeelDecay) {
		t.Fatalf("logged %+v", r.Emotions)
	}
}

func TestTownStartsCalm(t *testing.T) {
	for _, b := range townFor(1).Blobs {
		if b.Emotions != (Emotions{Calm: StartCalm}) {
			t.Fatalf("blob %d starts with %+v, want calm %v", b.ID, b.Emotions, StartCalm)
		}
	}
}

// Bold promises that break leave the town angrier than honest ones.
func TestBrokenPromisesSpreadRage(t *testing.T) {
	anger := func(r Round) float64 {
		a := 0.0
		for _, x := range r.Emotions.Anger {
			a += x
		}
		return a / float64(len(r.Emotions.Anger))
	}
	var bold, honest float64
	for seed := uint64(1); seed <= 10; seed++ {
		bold += anger(mustRun(t, seed, allBold[:1]).Rounds[9])
		honest += anger(mustRun(t, seed, allHonest[:1]).Rounds[9])
	}
	if bold <= 2*honest {
		t.Errorf("round 9 anger: bold %.1f%%, honest %.1f%%; want bold well above", bold/10, honest/10)
	}
	if bold/10 < 15 {
		t.Errorf("round 9 anger after a broken promise %.1f%%, want at least 15%%", bold/10)
	}
}

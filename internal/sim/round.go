package sim

import (
	"math"
	"math/rand/v2"
)

// MODEL.md#run-state
const (
	CompanyID        = -1
	StartCredibility = 1.0
)

// MODEL.md#actions
const (
	SocQuiet          = 0.10
	SocAverage        = 0.20
	SocChatty         = 0.40
	ActiveInterestW   = 0.40
	ActivePerceptionW = 0.20
	ActiveCap         = 0.90
	NoPostAge         = 13 // under this age never posts
	PostTeen          = 0.50
	PostAdult         = 0.30 // adults and elders
)

// MODEL.md#partner-choice
const (
	WeightSameHome  = 4.0
	WeightSameHood  = 2.0
	WeightSameShape = 1.5
)

// MODEL.md#trust
const (
	TrustMin          = 0.75
	TrustMax          = 3.0
	TrustSquareSame   = 2.0
	TrustSquareOther  = 0.80
	TrustTriangleAge  = 10
	TrustTriangleNear = 2.0
	TrustTriangleFar  = 0.75
	TrustStarLeader   = 3.0
	TrustStarSame     = 1.0
	TrustStarOther    = 0.80
	TrustTearSame     = 2.0
	TrustTearOther    = 0.75
	TrustCapsuleFam   = 3.0
	TrustCapsuleOther = 0.80
	TrustChildParent  = 2.0
	TrustElder        = 1.2
)

// MODEL.md#influence
const (
	AlphaPerK    = 0.08
	AlphaCap     = 0.50
	CredSkeptic  = 0.6
	CredGullible = 1.5
	PersWeak     = 0.6
	PersStrong   = 1.5
	ChannelW     = 1.0 // in person and company
	ChannelPostW = 0.5
)

// MODEL.md#repeat
const (
	RepeatSame   = 0.5
	RepeatPerNew = 0.25
	RepeatMaxNew = 4
)

// MODEL.md#social-media
const PostReaders = 8

// MODEL.md#decay
const (
	DecayRate   = 0.03
	DecayTarget = 10.0
)

// MODEL.md#announcements
const DirectReach = 0.30

// clampScore is the one place scores (and claim strengths) are kept in 0–100.
func clampScore(x float64) float64 { return math.Max(0, math.Min(100, x)) }

type blobState struct {
	perception, interest float64
	heard                float64
	hasHeard             bool
	// sources is only looked up and counted, never iterated, so map order can't leak.
	sources map[int]bool
}

// State is a run in progress. Scores are float64 per MODEL.md#interactions.
type State struct {
	Town        Town
	Round       int     // index of the next round Step will play
	Broken      int     // MODEL.md#run-state; owned by shipping (#15)
	Credibility float64 // MODEL.md#run-state; owned by shipping (#15)
	brain       Brain
	blobs       []blobState
	parentOf    map[[2]int]bool // {parent, child}; lookups only
}

// NewState starts a run on town. The town is not modified.
func NewState(t Town, brain Brain) *State {
	s := &State{Town: t, Credibility: StartCredibility, brain: brain, parentOf: map[[2]int]bool{}}
	s.blobs = make([]blobState, len(t.Blobs))
	for i, b := range t.Blobs {
		s.blobs[i] = blobState{perception: float64(b.Perception), interest: float64(b.Interest), sources: map[int]bool{}}
	}
	for _, f := range t.Families {
		for _, p := range f.Parents {
			for _, c := range f.Children {
				s.parentOf[[2]int{p, c}] = true
			}
		}
	}
	return s
}

// announce resets heard/sources and makes the company's direct hearings,
// per MODEL.md#announcements. Unexported: #15 owns the announcement API.
// Leaders are reached without an rng draw; others draw once each, by id.
func (s *State) announce(claimed float64, rng *rand.Rand) {
	for i := range s.blobs {
		s.blobs[i].hasHeard, s.blobs[i].heard = false, 0
		s.blobs[i].sources = map[int]bool{}
	}
	tone := 50 + claimed/2
	for i, b := range s.Town.Blobs {
		if hasTrait(b, TraitLeader) || rng.Float64() < DirectReach {
			s.hear(i, CompanyID, claimed, tone, ChannelCompany)
		}
	}
}

func hasTrait(b Blob, t Trait) bool {
	for _, x := range b.Traits {
		if x == t {
			return true
		}
	}
	return false
}

func soc(b Blob) float64 {
	switch {
	case hasTrait(b, TraitQuiet):
		return SocQuiet
	case hasTrait(b, TraitChatty):
		return SocChatty
	}
	return SocAverage
}

func (s *State) pActive(i int) float64 {
	b := s.blobs[i]
	return math.Min(ActiveCap, soc(s.Town.Blobs[i])+ActiveInterestW*b.interest/100+ActivePerceptionW*math.Abs(b.perception-50)/50)
}

func pPost(age int) float64 {
	switch {
	case age < NoPostAge:
		return 0
	case age < AdultMinAge:
		return PostTeen
	}
	return PostAdult
}

func (s *State) trust(l, sp int) float64 {
	if sp == CompanyID {
		return 1.0
	}
	L, S := s.Town.Blobs[l], s.Town.Blobs[sp]
	var t float64
	switch L.Shape {
	case ShapeSquare:
		t = pick(S.Shape == L.Shape, TrustSquareSame, TrustSquareOther)
	case ShapeCircle:
		t = 1.0
	case ShapeTriangle:
		d := L.Age - S.Age
		t = pick(d <= TrustTriangleAge && d >= -TrustTriangleAge, TrustTriangleNear, TrustTriangleFar)
	case ShapeStar:
		switch {
		case S.Shape == L.Shape && hasTrait(S, TraitLeader):
			t = TrustStarLeader
		case S.Shape == L.Shape:
			t = TrustStarSame
		default:
			t = TrustStarOther
		}
	case ShapeTear:
		t = pick(S.NeighbourhoodID == L.NeighbourhoodID, TrustTearSame, TrustTearOther)
	case ShapeCapsule:
		t = pick(L.FamilyID != NoFamily && S.FamilyID == L.FamilyID, TrustCapsuleFam, TrustCapsuleOther)
	}
	if L.Age < AdultMinAge && s.parentOf[[2]int{sp, l}] {
		t *= TrustChildParent
	}
	if L.Age >= ElderMinAge {
		t *= TrustElder
	}
	return math.Max(TrustMin, math.Min(TrustMax, t))
}

func pick(c bool, a, b float64) float64 {
	if c {
		return a
	}
	return b
}

func cred(b Blob) float64 {
	switch {
	case hasTrait(b, TraitSkeptic):
		return CredSkeptic
	case hasTrait(b, TraitGullible):
		return CredGullible
	}
	return 1.0
}

func (s *State) pers(sp int) float64 {
	if sp == CompanyID {
		return 1.0
	}
	b := s.Town.Blobs[sp]
	switch {
	case hasTrait(b, TraitUnconvincing):
		return PersWeak
	case hasTrait(b, TraitCharismatic):
		return PersStrong
	}
	return 1.0
}

// repeat is MODEL.md#repeat, using the count before sp is added.
func repeat(sources map[int]bool, sp int) float64 {
	switch {
	case sources[sp]:
		return RepeatSame
	case len(sources) >= 1:
		return 1.0 + RepeatPerNew*float64(min(len(sources)-1, RepeatMaxNew))
	}
	return 1.0
}

func (s *State) k(l, sp int, ch Channel) float64 {
	cw := ChannelW
	if ch == ChannelPost {
		cw = ChannelPostW
	}
	return cred(s.Town.Blobs[l]) * s.pers(sp) * s.trust(l, sp) * cw * repeat(s.blobs[l].sources, sp) * s.Credibility
}

// retellTone is T from MODEL.md#influence.
func retellTone(tellerPerception, c float64) float64 {
	return 0.5*tellerPerception + 0.5*(50+c/2)
}

// hear applies one hearing (MODEL.md#influence) to listener l.
func (s *State) hear(l, sp int, c, tone float64, ch Channel) {
	alpha := math.Min(AlphaCap, AlphaPerK*s.k(l, sp, ch))
	b := &s.blobs[l]
	b.interest = clampScore(b.interest + alpha*(c-b.interest))
	b.perception = clampScore(b.perception + alpha*(tone-b.perception))
	if !b.hasHeard {
		b.heard, b.hasHeard = c, true
	} else {
		n := float64(len(b.sources))
		b.heard = (b.heard*n + c) / (n + 1)
	}
	b.sources[sp] = true
}

func (s *State) partner(a int, rng *rand.Rand) int {
	A := s.Town.Blobs[a]
	w := make([]float64, len(s.Town.Blobs))
	total := 0.0
	for i, B := range s.Town.Blobs {
		if i == a || hasTrait(B, TraitRecluse) {
			continue
		}
		w[i] = pick(A.HomeID == B.HomeID, WeightSameHome, 1) *
			pick(A.NeighbourhoodID == B.NeighbourhoodID, WeightSameHood, 1) *
			pick(A.Shape == B.Shape, WeightSameShape, 1)
		total += w[i]
	}
	x := rng.Float64() * total
	last := -1
	for i, wi := range w {
		if wi == 0 {
			continue
		}
		last = i
		if x < wi {
			return i
		}
		x -= wi
	}
	return last // float round-off guard
}

// readers draws PostReaders distinct blobs other than sp, uniformly (partial Fisher–Yates).
func (s *State) readers(sp int, rng *rand.Rand) []int {
	pool := make([]int, 0, len(s.Town.Blobs)-1)
	for i := range s.Town.Blobs {
		if i != sp {
			pool = append(pool, i)
		}
	}
	n := min(PostReaders, len(pool))
	for i := range n {
		j := i + rng.IntN(len(pool)-i)
		pool[i], pool[j] = pool[j], pool[i]
	}
	return pool[:n]
}

// RunEvent is one talk (one listener) or post (several readers). JSON keys are
// short because the whole log goes to the browser.
type RunEvent struct {
	From  int       `json:"f"`
	To    []int     `json:"to"`
	Post  bool      `json:"p"`
	Claim float64   `json:"c"`  // strength told, 0–100
	DP    []float64 `json:"dp"` // perception change per To, same order
	DI    []float64 `json:"di"` // interest change per To, same order
}

// Round is one played round. Perception/Interest are indexed by blob id,
// after decay. Score values are rounded to 0.1 for the log only.
type Round struct {
	Index         int        `json:"i"`
	Events        []RunEvent `json:"events"`
	Perception    []float64  `json:"perception"`
	Interest      []float64  `json:"interest"`
	AvgPerception float64    `json:"avgPerception"`
	AvgInterest   float64    `json:"avgInterest"`
}

// RunLog is the replay contract with the client.
type RunLog struct {
	Seed   uint64  `json:"seed"`
	Town   Town    `json:"town"` // initial town
	Rounds []Round `json:"rounds"`
}

// NewRunLog starts an empty log for town.
func NewRunLog(seed uint64, t Town) RunLog {
	return RunLog{Seed: seed, Town: t, Rounds: []Round{}}
}

func round1(x float64) float64 { return math.Round(x*10) / 10 }

// Step plays one round: actions by id, then decay, then records scores.
// Announce and ship (#15) run on the State before Step, per MODEL.md#round-order.
func (s *State) Step(rng *rand.Rand) Round {
	r := Round{Index: s.Round, Events: []RunEvent{}}
	for i, B := range s.Town.Blobs {
		b := s.blobs[i]
		if !b.hasHeard || rng.Float64() >= s.pActive(i) {
			continue
		}
		post := hasTrait(B, TraitRecluse)
		if !post && B.Age >= NoPostAge {
			post = rng.Float64() < pPost(B.Age)
		}
		ch, to := ChannelTalk, []int(nil)
		if post {
			ch, to = ChannelPost, s.readers(i, rng)
		} else {
			to = []int{s.partner(i, rng)}
		}
		listener := NoListener
		if !post {
			listener = to[0]
		}
		c := s.brain.Retell(Retelling{Teller: i, Listener: listener, TellerPerception: b.perception, Heard: b.heard, Channel: ch}).Strength
		tone := retellTone(b.perception, c)
		e := RunEvent{From: i, To: to, Post: post, Claim: round1(c)}
		for _, l := range to {
			p0, i0 := s.blobs[l].perception, s.blobs[l].interest
			s.hear(l, i, c, tone, ch)
			e.DP = append(e.DP, round1(s.blobs[l].perception-p0))
			e.DI = append(e.DI, round1(s.blobs[l].interest-i0))
		}
		r.Events = append(r.Events, e)
	}
	n := float64(len(s.blobs))
	for i := range s.blobs {
		b := &s.blobs[i]
		b.interest = clampScore(b.interest + DecayRate*(DecayTarget-b.interest))
		r.Perception = append(r.Perception, round1(b.perception))
		r.Interest = append(r.Interest, round1(b.interest))
		r.AvgPerception += b.perception / n
		r.AvgInterest += b.interest / n
	}
	r.AvgPerception, r.AvgInterest = round1(r.AvgPerception), round1(r.AvgInterest)
	s.Round++
	return r
}

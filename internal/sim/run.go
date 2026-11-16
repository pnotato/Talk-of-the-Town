package sim

import (
	"fmt"
	"math"

	"talkofthetown/internal/sim/content"
)

// MODEL.md#round-order
const (
	RunRounds    = 50
	MomentEvery  = 10
	ShipAfter    = 8
	ContentLabel = "SIMULATED" // MODEL.md#announcements
)

// MODEL.md#shipping
const (
	UnheardWeight   = 0.5
	GapPerception   = 0.25
	LossWeight      = 2.0
	ShipInterest    = 0.30
	BrokenThreshold = 15
	CredPerBroken   = 0.80
	CredFloor       = 0.30
)

// ship applies MODEL.md#shipping for one story.
func (s *State) ship(claimed, delivered float64) {
	for i := range s.blobs {
		b := &s.blobs[i]
		h, w := claimed, UnheardWeight
		if b.hasHeard {
			h, w = b.heard, 1.0
		}
		gap := delivered - h
		loss := 1.0
		if gap < 0 {
			loss = LossWeight
		}
		b.perception = clampScore(b.perception + w*GapPerception*loss*gap)
		b.interest = clampScore(b.interest + ShipInterest*(delivered-b.interest))
	}
	if claimed-delivered > BrokenThreshold {
		s.Broken++
	}
	s.Credibility = math.Max(CredFloor, math.Pow(CredPerBroken, float64(s.Broken)))
}

// MomentLog is one announcement the player chose. It is announced at Round
// and ships at Round+ShipAfter (if that round was played).
type MomentLog struct {
	ID          string  `json:"id"`
	Round       int     `json:"round"`
	OptionID    string  `json:"optionId"`
	Headline    string  `json:"headline"`
	Claimed     int     `json:"claimed"`
	Delivered   int     `json:"delivered"`
	Shipped     bool    `json:"shipped"`
	Broken      bool    `json:"broken"`      // set when shipped and a broken promise
	Credibility float64 `json:"credibility"` // town credibility after this ship (or current, if not shipped)
}

// Pending is the next moment the player must choose for.
type Pending struct {
	ID      string           `json:"id"`
	Round   int              `json:"round"`
	Feature string           `json:"feature"`
	Options []content.Option `json:"options"`
}

// Run plays a run from seed with one option id per moment, in order. It stops
// before the first moment with no choice yet and reports it in RunLog.Next.
func Run(seed uint64, choices []string, brain Brain) (RunLog, error) {
	a, err := content.LoadAnnouncements()
	if err != nil {
		return RunLog{}, err
	}
	if len(choices) > len(a.Moments) {
		return RunLog{}, fmt.Errorf("%d choices for %d moments", len(choices), len(a.Moments))
	}
	opts := make([]content.Option, len(choices))
	for k, id := range choices {
		m := a.Moments[k]
		if m.Round != k*MomentEvery {
			return RunLog{}, fmt.Errorf("moment %s at round %d, want %d", m.ID, m.Round, k*MomentEvery)
		}
		found := false
		for _, o := range m.Options {
			if o.ID == id {
				opts[k], found = o, true
			}
		}
		if !found {
			return RunLog{}, fmt.Errorf("choice %d: %q is not an option of moment %s", k, id, m.ID)
		}
	}

	rng := NewRNG(seed)
	town := NewTown(rng)
	st := NewState(town, brain)
	log := NewRunLog(seed, town)
	log.Label, log.Company, log.Moments = a.Label, a.Company.Name, []MomentLog{}
	for r := range RunRounds {
		k := r / MomentEvery
		switch r % MomentEvery {
		case 0:
			if k >= len(choices) {
				m := a.Moments[k]
				log.Next = &Pending{ID: m.ID, Round: m.Round, Feature: m.Feature, Options: m.Options}
				return log, nil
			}
			o := opts[k]
			st.announce(float64(o.Claimed), rng)
			log.Moments = append(log.Moments, MomentLog{ID: a.Moments[k].ID, Round: r, OptionID: o.ID,
				Headline: o.Headline, Claimed: o.Claimed, Delivered: o.Delivered, Credibility: st.Credibility})
		case ShipAfter:
			o, before := opts[k], st.Broken
			st.ship(float64(o.Claimed), float64(o.Delivered))
			m := &log.Moments[k]
			m.Shipped, m.Broken, m.Credibility = true, st.Broken > before, st.Credibility
		}
		log.Rounds = append(log.Rounds, st.Step(rng))
	}
	return log, nil
}

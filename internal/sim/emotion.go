package sim

import "math"

// Emotions is a blob's emotion mix in percent: how much of it is calm, and how much each feeling
// has stirred it. The shares add up to 100. MODEL.md#emotions
type Emotions struct {
	Calm     float64 `json:"calm"`
	Joy      float64 `json:"joy"`
	Trust    float64 `json:"trust"`
	Surprise float64 `json:"surprise"`
	Fear     float64 `json:"fear"`
	Sadness  float64 `json:"sadness"`
	Anger    float64 `json:"anger"`
}

// EmotionLog is every blob's emotion mix after a round: each field holds that emotion's share for
// every blob, indexed by blob id, in whole percent. A struct of lists rather than a list of
// Emotions keeps the log small, since it goes to the browser every round.
type EmotionLog struct {
	Calm     []float64 `json:"calm"`
	Joy      []float64 `json:"joy"`
	Trust    []float64 `json:"trust"`
	Surprise []float64 `json:"surprise"`
	Fear     []float64 `json:"fear"`
	Sadness  []float64 `json:"sadness"`
	Anger    []float64 `json:"anger"`
}

// Indexes into feelings, in the field order of Emotions.
const (
	emoCalm = iota
	emoJoy
	emoTrust
	emoSurprise
	emoFear
	emoSadness
	emoAnger
	numEmotions
)

// feelings is the sim's working copy of an emotion mix, as a list so rules can loop over it.
type feelings [numEmotions]float64

func (e *Emotions) fields() [numEmotions]*float64 {
	return [...]*float64{&e.Calm, &e.Joy, &e.Trust, &e.Surprise, &e.Fear, &e.Sadness, &e.Anger}
}

func (l *EmotionLog) fields() [numEmotions]*[]float64 {
	return [...]*[]float64{&l.Calm, &l.Joy, &l.Trust, &l.Surprise, &l.Fear, &l.Sadness, &l.Anger}
}

func feelingsOf(e Emotions) feelings {
	var f feelings
	for k, p := range e.fields() {
		f[k] = *p
	}
	return f
}

// newEmotionLog is an empty log with no nil lists, so every key is in the JSON.
func newEmotionLog(blobs int) EmotionLog {
	var l EmotionLog
	for _, p := range l.fields() {
		*p = make([]float64, 0, blobs)
	}
	return l
}

// add appends one blob's mix, rounded to whole percent for the log only.
func (l *EmotionLog) add(f feelings) {
	for k, p := range l.fields() {
		*p = append(*p, math.Round(f[k]))
	}
}

// MODEL.md#emotions
const (
	StartCalm = 100.0
	// A hearing moves the listener's mix a fraction min(FeelCap, FeelPerK × k × arousal) of the way
	// to the feelings it carries, where k is MODEL.md#influence's k without credibility.
	FeelPerK = 0.40
	FeelCap  = 0.60
	// Arousal weights: a hearing's arousal is the share-weighted mean of these over the feelings it
	// carries, so calm news spreads at 1×, pure rage at 2× and pure sadness at 0.5×.
	ArousalCalm     = 1.0
	ArousalJoy      = 1.0
	ArousalTrust    = 1.0
	ArousalSurprise = 1.5
	ArousalFear     = 1.5
	ArousalSadness  = 0.5
	ArousalAnger    = 2.0
	// At a ship, feelings move ShipFeelPerPoint per point of gap between what shipped and what the
	// blob heard, up to ShipFeelCap, at the same weight as perception (half for the unheard).
	ShipFeelPerPoint = 0.015
	ShipFeelCap      = 0.60
	// A let-down of d points is d / (d + RageHalfGap) anger and the rest sadness: small ones
	// disappoint, big ones enrage.
	RageHalfGap = 20.0
	// Every round, feelings move this fraction back toward calm.
	FeelDecay = 0.10
)

var (
	arousalWeight = feelings{ArousalCalm, ArousalJoy, ArousalTrust, ArousalSurprise, ArousalFear,
		ArousalSadness, ArousalAnger}
	calmOnly = feelings{emoCalm: StartCalm}

	// What an announcement makes people feel: an honest claim reads as believable and pleasing, a
	// bold one as startling, exciting and a little scary. MODEL.md#emotions
	honestNews = feelings{emoTrust: 60, emoJoy: 20, emoCalm: 20}
	boldNews   = feelings{emoSurprise: 50, emoJoy: 30, emoFear: 20}

	// How a ship that beats what a blob heard feels. MODEL.md#emotions
	pleased = feelings{emoJoy: 70, emoTrust: 30}
)

// newsFeelings is what a claim of strength c stirs on its own: honestNews and boldNews blended by
// c/100. The company's announcement carries exactly this.
func newsFeelings(c float64) feelings {
	f := honestNews
	blend(&f, boldNews, c/100)
	return f
}

// toldFeelings is what a retelling of claim c carries: the teller's own feelings, and in place of
// whatever share of the teller is calm, the feelings the claim stirs on its own.
func toldFeelings(teller feelings, c float64) feelings {
	news, calm := newsFeelings(c), teller[emoCalm]/100
	var f feelings
	for k := range f {
		f[k] = calm * news[k]
		if k != emoCalm {
			f[k] += teller[k]
		}
	}
	return f
}

// shipFeelings is how a ship feels, where gap is what shipped minus what the blob heard: a
// let-down when negative, a pleasant surprise otherwise.
func shipFeelings(gap float64) feelings {
	if gap >= 0 {
		return pleased
	}
	anger := 100 * -gap / (-gap + RageHalfGap)
	return feelings{emoAnger: anger, emoSadness: 100 - anger}
}

// arousal is how fast mix m spreads: the mean of arousalWeight, weighted by m's shares.
func arousal(m feelings) float64 {
	a := 0.0
	for k, x := range m {
		a += arousalWeight[k] * x / 100
	}
	return a
}

// blend moves mix e a fraction a (0–1) of the way to mix m. Both add up to 100, so e still does.
func blend(e *feelings, m feelings, a float64) {
	for k := range e {
		e[k] += a * (m[k] - e[k])
	}
}

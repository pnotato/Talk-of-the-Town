package sim

// Channel is how a hearing reaches a blob. MODEL.md#influence
type Channel string

const (
	ChannelTalk    Channel = "talk"
	ChannelPost    Channel = "post"
	ChannelCompany Channel = "company"
)

// Channels in fixed order, for the TS enum.
var Channels = [...]Channel{ChannelTalk, ChannelPost, ChannelCompany}

// Retelling is the input to one retelling by a blob.
type Retelling struct {
	Teller           int     // blob id
	Listener         int     // blob id, or NoListener for a post
	TellerPerception float64 // teller's current perception, 0–100
	Heard            float64 // claim strength the teller believes, 0–100
	Channel          Channel // ChannelTalk or ChannelPost
}

// NoListener marks a Retelling that is a post with many readers.
const NoListener = -1

// Told is a brain's output: the strength passed on, plus optional flavour text.
type Told struct {
	Strength float64
	Text     string
}

// Brain retells the current story. Implementations must return Strength from
// MODEL.md#drift; Text is flavour only. Brains must be deterministic and
// must not touch the sim's rng.
type Brain interface {
	Retell(Retelling) Told
}

// MODEL.md#drift
const (
	SharpenTalk     = 3.0
	SharpenPost     = 5.0
	DriftPerception = 0.10
)

// StubBrain applies MODEL.md#drift with no model calls.
type StubBrain struct{}

func (StubBrain) Retell(r Retelling) Told {
	sharpen := SharpenTalk
	if r.Channel == ChannelPost {
		sharpen = SharpenPost
	}
	return Told{Strength: clampScore(r.Heard + sharpen + DriftPerception*(r.TellerPerception-50))}
}

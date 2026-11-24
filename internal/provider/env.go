package provider

import (
	"fmt"
	"strconv"
	"time"

	"talkofthetown/internal/sim"
)

// VoiceFromEnv picks the voice from BRAIN (CLAUDE.md hard rule 2):
//
//	BRAIN=stub (or unset)  template lines, no model calls, $0
//	BRAIN=anthropic        Claude writes the lines; needs ANTHROPIC_API_KEY
//
// With anthropic it also reads MODEL and the VOICE_* caps (see .env.example). It returns a
// factory to call once per run, and a line describing the choice for the startup log.
func VoiceFromEnv(getenv func(string) string) (func() sim.Voice, string, error) {
	switch brain := getenv("BRAIN"); brain {
	case "", "stub":
		return func() sim.Voice { return sim.StubVoice{} }, "stub voice (template lines, no model calls)", nil
	case "anthropic":
		cfg := Config{APIKey: getenv("ANTHROPIC_API_KEY"), Model: getenv("MODEL")}
		if cfg.APIKey == "" {
			return nil, "", fmt.Errorf("BRAIN=anthropic needs ANTHROPIC_API_KEY in the server's environment (.env)")
		}
		var err error
		if cfg.InFlight, err = intEnv(getenv, "VOICE_IN_FLIGHT"); err != nil {
			return nil, "", err
		}
		if cfg.MaxCalls, err = intEnv(getenv, "VOICE_MAX_CALLS"); err != nil {
			return nil, "", err
		}
		secs, err := intEnv(getenv, "VOICE_TIMEOUT_SECONDS")
		if err != nil {
			return nil, "", err
		}
		cfg.Timeout = time.Duration(secs) * time.Second
		if v := getenv("VOICE_MAX_USD"); v != "" {
			if cfg.MaxUSD, err = strconv.ParseFloat(v, 64); err != nil || cfg.MaxUSD <= 0 {
				return nil, "", fmt.Errorf("VOICE_MAX_USD must be a positive number, got %q", v)
			}
		}
		a := NewAnthropic(cfg)
		desc := fmt.Sprintf("anthropic voice (%s, %d at once, %d calls per run, $%.2f spend cap)",
			a.cfg.Model, a.cfg.InFlight, a.cfg.MaxCalls, a.cfg.MaxUSD)
		return func() sim.Voice { return a.Run() }, desc, nil
	default:
		return nil, "", fmt.Errorf("BRAIN must be stub or anthropic, got %q", brain)
	}
}

// intEnv is a positive integer from the environment, or 0 (the default) when unset.
func intEnv(getenv func(string) string, name string) (int, error) {
	v := getenv(name)
	if v == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer, got %q", name, v)
	}
	return n, nil
}

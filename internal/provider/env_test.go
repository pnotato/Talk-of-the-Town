package provider

import (
	"strings"
	"testing"

	"talkofthetown/internal/sim"
)

func envOf(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestVoiceFromEnv(t *testing.T) {
	newVoice, desc, err := VoiceFromEnv(envOf(nil))
	if err != nil || !strings.HasPrefix(desc, "stub") {
		t.Fatalf("unset BRAIN: %q, %v", desc, err)
	}
	if _, ok := newVoice().(sim.StubVoice); !ok {
		t.Fatal("unset BRAIN must give the stub voice")
	}

	newVoice, desc, err = VoiceFromEnv(envOf(map[string]string{
		"BRAIN": "anthropic", "ANTHROPIC_API_KEY": "k", "VOICE_IN_FLIGHT": "8", "VOICE_MAX_USD": "1.5",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := newVoice().(*Run); !ok {
		t.Fatal("BRAIN=anthropic must give the anthropic voice")
	}
	if want := "anthropic voice (claude-haiku-5-5, 8 at once, 2500 calls per run, $1.50 spend cap)"; desc != want {
		t.Fatalf("desc %q, want %q", desc, want)
	}

	for _, env := range []map[string]string{
		{"BRAIN": "anthropic"}, // no key
		{"BRAIN": "openai"},
		{"BRAIN": "anthropic", "ANTHROPIC_API_KEY": "k", "VOICE_MAX_CALLS": "-1"},
		{"BRAIN": "anthropic", "ANTHROPIC_API_KEY": "k", "VOICE_MAX_USD": "lots"},
	} {
		if _, _, err := VoiceFromEnv(envOf(env)); err == nil {
			t.Errorf("%v: want an error", env)
		}
	}
}

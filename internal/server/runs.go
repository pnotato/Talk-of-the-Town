package server

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"talkofthetown/internal/sim"
	"talkofthetown/internal/sim/content"
)

// SampleSeed is the seed of the run cmd/server writes at startup.
const SampleSeed = 1

// WriteRun writes body, the encoded l, to dir and returns the file's path.
// It creates dir if needed, and writes a temp file in dir and renames it into
// place, so a reader never sees half a file.
func WriteRun(dir string, l sim.RunLog, body []byte) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	f, err := os.CreateTemp(dir, ".run-*.tmp")
	if err != nil {
		return "", err
	}
	_, err = f.Write(body)
	if err == nil {
		err = f.Chmod(0o644) // CreateTemp makes it owner-only
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	path := filepath.Join(dir, runFileName(l))
	if err == nil {
		err = os.Rename(f.Name(), path)
	}
	if err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return path, nil
}

// runFileName is seed-<seed>_<optionId>_..._<optionId>.json, from the log's
// own moments. sim.Run has already checked the ids against the content; they
// are still cut down to [A-Za-z0-9-] so a name can never leave dir.
func runFileName(l sim.RunLog) string {
	var b strings.Builder
	fmt.Fprintf(&b, "seed-%d", l.Seed)
	for _, m := range l.Moments {
		b.WriteByte('_')
		b.WriteString(strings.Map(func(r rune) rune {
			if r == '-' || '0' <= r && r <= '9' || 'A' <= r && r <= 'Z' || 'a' <= r && r <= 'z' {
				return r
			}
			return '-'
		}, m.OptionID))
	}
	b.WriteString(".json")
	return b.String()
}

// WriteSampleRun plays SampleSeed with the first option of every moment, narrates
// it with the stub voice, and writes it to dir with WriteRun, so a dev server always
// has a log to open. The bytes are what POST /api/run returns for the same request
// with the stub voice.
func WriteSampleRun(dir string, brain sim.Brain) (string, error) {
	a, err := content.LoadAnnouncements()
	if err != nil {
		return "", err
	}
	choices := make([]string, len(a.Moments))
	for k, m := range a.Moments {
		if len(m.Options) == 0 {
			return "", fmt.Errorf("moment %s has no options", m.ID)
		}
		choices[k] = m.Options[0].ID
	}
	l, err := sim.Run(SampleSeed, choices, brain)
	if err != nil {
		return "", err
	}
	if err := sim.Narrate(context.Background(), &l, sim.StubVoice{}); err != nil {
		return "", err
	}
	body, err := encodeJSON(l)
	if err != nil {
		return "", err
	}
	return WriteRun(dir, l, body)
}

package server

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"talkofthetown/internal/sim"
)

const (
	fullRunBody = `{"seed":7,"choices":["m0-honest","m1-bold","m2-honest","m3-bold","m4-upbeat"]}`
	fullRunFile = "seed-7_m0-honest_m1-bold_m2-honest_m3-bold_m4-upbeat.json"
)

func newWithRuns(dir string) http.Handler {
	return New(Config{MaxRounds: DefaultMaxRounds, MaxBlobs: DefaultMaxBlobs, RunsDir: dir}, sim.StubBrain{}, nil, nil)
}

// names lists dir's entries; a missing dir has none.
func names(t *testing.T, dir string) []string {
	t.Helper()
	es, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range es {
		out = append(out, e.Name())
	}
	return out
}

// captureLog sends the standard logger to a buffer for the rest of the test.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return &buf
}

func TestRunWritesFullRun(t *testing.T) {
	logs := captureLog(t)
	dir := filepath.Join(t.TempDir(), "runs", "scratch") // the server creates it
	rec := postRun(newWithRuns(dir), fullRunBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if got := names(t, dir); !slices.Equal(got, []string{fullRunFile}) {
		t.Fatalf("files %v, want [%s]", got, fullRunFile)
	}
	got, err := os.ReadFile(filepath.Join(dir, fullRunFile))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, rec.Body.Bytes()) {
		t.Fatal("file bytes differ from the response body")
	}
	if !strings.Contains(logs.String(), fullRunFile) {
		t.Fatalf("log %q does not name the file", logs)
	}
	// The same run again replaces the file and leaves no temp file behind.
	postRun(newWithRuns(dir), fullRunBody)
	if got := names(t, dir); !slices.Equal(got, []string{fullRunFile}) {
		t.Fatalf("after a second run: files %v, want [%s]", got, fullRunFile)
	}
}

func TestRunPartialWritesNothing(t *testing.T) {
	dir := t.TempDir()
	for _, body := range []string{`{"seed":7,"choices":[]}`, `{"seed":7,"choices":["m0-honest","m1-bold"]}`} {
		if rec := postRun(newWithRuns(dir), body); rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d: %s", body, rec.Code, rec.Body)
		}
	}
	if got := names(t, dir); len(got) != 0 {
		t.Fatalf("partial runs wrote %v", got)
	}
}

func TestRunWithoutRunsDirWritesNothing(t *testing.T) {
	cwd := t.TempDir()
	t.Chdir(cwd)
	if rec := postRun(newTest(), fullRunBody); rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if got := names(t, cwd); len(got) != 0 {
		t.Fatalf("wrote %v with no RunsDir", got)
	}
}

func TestRunUnwritableDirStillAnswers(t *testing.T) {
	logs := captureLog(t)
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	rec := postRun(newWithRuns(filepath.Join(file, "runs")), fullRunBody) // a dir under a file
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if want := postRun(newTest(), fullRunBody); !bytes.Equal(rec.Body.Bytes(), want.Body.Bytes()) {
		t.Fatal("body differs from a server that writes nothing")
	}
	if !strings.Contains(logs.String(), "not written") {
		t.Fatalf("log %q, want the write error", logs)
	}
}

func TestRunFileName(t *testing.T) {
	moments := func(ids ...string) []sim.MomentLog {
		var ms []sim.MomentLog
		for _, id := range ids {
			ms = append(ms, sim.MomentLog{OptionID: id})
		}
		return ms
	}
	tests := []struct {
		name string
		log  sim.RunLog
		want string
	}{
		{"full run", sim.RunLog{Seed: 7, Moments: moments("m0-honest", "m1-bold")}, "seed-7_m0-honest_m1-bold.json"},
		{"no moments", sim.RunLog{Seed: 3}, "seed-3.json"},
		{"path parts", sim.RunLog{Seed: 1, Moments: moments("../../etc/passwd")}, "seed-1_------etc-passwd.json"},
		{"separators and spaces", sim.RunLog{Seed: 1, Moments: moments("a b_c.d")}, "seed-1_a-b-c-d.json"},
		{"non-ASCII", sim.RunLog{Seed: 1, Moments: moments("café")}, "seed-1_caf-.json"},
		{"largest seed", sim.RunLog{Seed: sim.MaxSeed}, "seed-9007199254740991.json"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := runFileName(tt.log); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestWriteSampleRun(t *testing.T) {
	dir := t.TempDir()
	path, err := WriteSampleRun(dir, sim.StubBrain{})
	if err != nil {
		t.Fatal(err)
	}
	first := []string{"m0-honest", "m1-modest", "m2-honest", "m3-modest", "m4-honest"}
	if want := filepath.Join(dir, "seed-1_"+strings.Join(first, "_")+".json"); path != want {
		t.Fatalf("path %q, want %q", path, want)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// It is exactly what the API returns for the same seed and choices.
	req, _ := json.Marshal(map[string]any{"seed": SampleSeed, "choices": first})
	if rec := postRun(newTest(), string(req)); !bytes.Equal(got, rec.Body.Bytes()) {
		t.Fatal("sample file differs from the API's response for the same run")
	}
	if n := names(t, dir); len(n) != 1 {
		t.Fatalf("files %v, want only the sample", n)
	}
}

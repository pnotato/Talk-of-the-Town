package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"talkofthetown/internal/sim"
	"talkofthetown/internal/sim/citymap"
)

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	newTest().ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got, want := rec.Body.String(), "{\"status\":\"ok\"}\n"; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
}

func getTown(t *testing.T, query string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	newTest().ServeHTTP(rec, httptest.NewRequest("GET", "/api/town"+query, nil))
	return rec
}

func TestTownSameSeedSameBody(t *testing.T) {
	a, b := getTown(t, "?seed=42"), getTown(t, "?seed=42")
	if a.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", a.Code, a.Body)
	}
	if ct := a.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if a.Body.String() != b.Body.String() {
		t.Fatal("same seed gave different bodies")
	}
	if c := getTown(t, "?seed=43"); c.Body.String() == a.Body.String() {
		t.Fatal("different seeds gave the same body")
	}
}

func TestTownBadSeed(t *testing.T) {
	for _, q := range []string{"", "?seed=", "?seed=abc", "?seed=-1", "?seed=1.5", "?seed=18446744073709551616", "?seed=9007199254740992"} {
		t.Run(q, func(t *testing.T) {
			rec := getTown(t, q)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("Content-Type = %q", ct)
			}
			if !strings.Contains(rec.Body.String(), `"error"`) {
				t.Fatalf("body = %q, want JSON error", rec.Body)
			}
		})
	}
}

func newTest() http.Handler {
	return New(Config{MaxRounds: DefaultMaxRounds, MaxBlobs: DefaultMaxBlobs}, sim.StubBrain{}, nil, nil)
}

func postRun(h http.Handler, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/run", strings.NewReader(body)))
	return rec
}

func TestRunHappyPath(t *testing.T) {
	body := `{"seed":42,"choices":["m0-honest","m1-bold"]}`
	a, b := postRun(newTest(), body), postRun(newTest(), body)
	if a.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", a.Code, a.Body)
	}
	if a.Body.String() != b.Body.String() {
		t.Fatal("same request gave different bodies")
	}
	var log sim.RunLog
	if err := json.Unmarshal(a.Body.Bytes(), &log); err != nil {
		t.Fatal(err)
	}
	if len(log.Rounds) != 20 || log.Next == nil || log.Next.Round != 20 || log.Label != "SIMULATED" {
		t.Fatalf("rounds=%d next=%+v label=%q", len(log.Rounds), log.Next, log.Label)
	}
}

// recordVoice counts scenes, so a test can see that /api/run asks the voice it was given.
type recordVoice struct{ scenes atomic.Int64 }

func (v *recordVoice) Speak(ctx context.Context, s sim.Scene) sim.Lines {
	v.scenes.Add(1)
	return sim.Lines{Thought: "a thought", Words: "some words", Hearers: make([]string, len(s.Hearers))}
}

func TestRunIsNarrated(t *testing.T) {
	var made atomic.Int64
	v := &recordVoice{}
	h := New(Config{MaxRounds: DefaultMaxRounds, MaxBlobs: DefaultMaxBlobs}, sim.StubBrain{},
		func() sim.Voice { made.Add(1); return v }, nil)
	rec := postRun(h, `{"seed":42,"choices":["m0-honest"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var log sim.RunLog
	if err := json.Unmarshal(rec.Body.Bytes(), &log); err != nil {
		t.Fatal(err)
	}
	events := 0
	for _, round := range log.Rounds {
		for _, e := range round.Events {
			events++
			if e.Scroll {
				continue // a scroll's words are the post it read
			}
			if e.Words != "some words" || e.Thought != "a thought" || len(e.Replies) != len(e.To) {
				t.Fatalf("event not narrated by the voice: %+v", e)
			}
		}
	}
	if made.Load() != 1 || v.scenes.Load() != int64(events) || events == 0 {
		t.Fatalf("voices made %d, scenes %d, events %d", made.Load(), v.scenes.Load(), events)
	}
}

func TestRunTownMap(t *testing.T) {
	rec := postRun(newTest(), `{"seed":42,"choices":[],"map":"town"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var log sim.RunLog
	if err := json.Unmarshal(rec.Body.Bytes(), &log); err != nil {
		t.Fatal(err)
	}
	g, err := citymap.TownGraph()
	if err != nil {
		t.Fatal(err)
	}
	if len(log.Map.Nodes) != g.Len() || log.Map.Stand != g.NumStand {
		t.Fatalf("map has %d nodes (%d stand), want town's %d (%d)", len(log.Map.Nodes), log.Map.Stand, g.Len(), g.NumStand)
	}

	cityRec := postRun(newTest(), `{"seed":42,"choices":[]}`)
	if cityRec.Code != http.StatusOK {
		t.Fatalf("city run: status = %d: %s", cityRec.Code, cityRec.Body)
	}
	var city sim.RunLog
	if err := json.Unmarshal(cityRec.Body.Bytes(), &city); err != nil {
		t.Fatal(err)
	}
	if len(city.Map.Nodes) == len(log.Map.Nodes) {
		t.Fatalf("city and town runs both have %d nodes; the map was not switched", len(log.Map.Nodes))
	}
}

func TestRunBadRequests(t *testing.T) {
	for name, body := range map[string]string{
		"bad json":       `{"seed":`,
		"unknown field":  `{"seed":1,"choices":[],"x":1}`,
		"missing seed":   `{"choices":[]}`,
		"negative seed":  `{"seed":-1,"choices":[]}`,
		"seed too large": `{"seed":9007199254740992,"choices":[]}`,
		"unknown option": `{"seed":1,"choices":["nope"]}`,
		"wrong moment":   `{"seed":1,"choices":["m1-honest"]}`,
		"too many":       `{"seed":1,"choices":["m0-honest","m1-honest","m2-honest","m3-honest","m4-honest","m4-honest"]}`,
		"trailing data":  `{"seed":1,"choices":[]} {}`,
		"trailing brace": `{"seed":1,"choices":[]}}`,
		"trailing brack": `{"seed":1,"choices":[]}]`,
		"too big":        `{"seed":1,"choices":["` + strings.Repeat("a", 5000) + `"]}`,
		"unknown map":    `{"seed":1,"choices":[],"map":"moon"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if rec := postRun(newTest(), body); rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body)
			}
		})
	}
}

func TestRunCaps(t *testing.T) {
	body := `{"seed":1,"choices":["m0-honest","m1-honest"]}`
	for _, c := range []struct {
		cfg  Config
		want int
	}{
		{Config{MaxRounds: 20, MaxBlobs: 100}, http.StatusOK},
		{Config{MaxRounds: 10, MaxBlobs: 100}, http.StatusUnprocessableEntity},
		{Config{MaxRounds: 50, MaxBlobs: 99}, http.StatusUnprocessableEntity},
	} {
		if rec := postRun(New(c.cfg, sim.StubBrain{}, nil, nil), body); rec.Code != c.want {
			t.Errorf("%+v: status = %d, want %d", c.cfg, rec.Code, c.want)
		}
	}
}

func TestConfigFromEnv(t *testing.T) {
	t.Setenv("MAX_ROUNDS", "")
	t.Setenv("MAX_BLOBS", "")
	t.Setenv("RUNS_DIR", "")
	if c, err := ConfigFromEnv(); err != nil || c != (Config{MaxRounds: 50, MaxBlobs: 100}) {
		t.Fatalf("defaults: %+v %v", c, err)
	}
	t.Setenv("RUNS_DIR", "runs/scratch")
	if c, _ := ConfigFromEnv(); c.RunsDir != "runs/scratch" {
		t.Fatalf("RunsDir = %q", c.RunsDir)
	}
	t.Setenv("MAX_ROUNDS", "20")
	if c, _ := ConfigFromEnv(); c.MaxRounds != 20 {
		t.Fatalf("MaxRounds = %d", c.MaxRounds)
	}
	t.Setenv("MAX_BLOBS", "lots")
	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("want error")
	}
}

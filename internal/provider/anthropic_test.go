package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"talkofthetown/internal/sim"
)

// fakeAPI is a stand-in for POST /v1/messages. reply builds the tool input for each request;
// every request body is checked against what the voice must send.
type fakeAPI struct {
	t        *testing.T
	requests atomic.Int64
	status   int    // non-zero: answer every request with this status
	stop     string // stop_reason to send; default tool_use
	reply    func(tool string) map[string]any
}

func (f *fakeAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.requests.Add(1)
	if r.URL.Path != "/v1/messages" {
		f.t.Errorf("path %s, want /v1/messages", r.URL.Path)
	}
	// The SDK sends the key as x-api-key or as a bearer token, depending on its version.
	if r.Header.Get("X-Api-Key") != "test-key" && r.Header.Get("Authorization") != "Bearer test-key" {
		f.t.Errorf("the API key isn't sent (headers %v)", r.Header)
	}
	w.Header().Set("Content-Type", "application/json")
	if f.status != 0 {
		w.WriteHeader(f.status)
		w.Write([]byte(`{"type":"error","error":{"type":"api_error","message":"boom"}}`))
		return
	}
	var req struct {
		Model  string `json:"model"`
		System []struct {
			Text         string            `json:"text"`
			CacheControl map[string]string `json:"cache_control"`
		} `json:"system"`
		Tools []struct {
			Name        string         `json:"name"`
			Strict      bool           `json:"strict"`
			InputSchema map[string]any `json:"input_schema"`
		} `json:"tools"`
		ToolChoice map[string]string `json:"tool_choice"`
		Thinking   map[string]string `json:"thinking"`
		Messages   []struct {
			Role    string `json:"role"`
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		f.t.Fatalf("decode request: %v", err)
	}
	if req.Model != DefaultModel {
		f.t.Errorf("model %q", req.Model)
	}
	if len(req.System) != 1 || req.System[0].Text != systemPrompt || req.System[0].CacheControl["type"] != "ephemeral" {
		f.t.Errorf("system prompt must be the fixed text with one ephemeral cache breakpoint")
	}
	if len(req.Tools) != 3 || req.Tools[0].Name != toolPost || req.Tools[1].Name != toolScroll || req.Tools[2].Name != toolTalk {
		f.t.Errorf("tools must be post, scroll, talk in that order: %+v", req.Tools)
	}
	for _, tool := range req.Tools {
		if !tool.Strict || tool.InputSchema["additionalProperties"] != false {
			f.t.Errorf("tool %s must be strict with additionalProperties false", tool.Name)
		}
	}
	if req.ToolChoice["type"] != "tool" {
		f.t.Errorf("tool_choice %v, want a forced tool", req.ToolChoice)
	}
	if req.Thinking["type"] != "disabled" {
		f.t.Errorf("thinking %v, want disabled", req.Thinking)
	}
	if len(req.Messages) != 1 || req.Messages[0].Role != "user" || len(req.Messages[0].Content) != 1 {
		f.t.Fatalf("want one user message, got %+v", req.Messages)
	}
	tool := req.ToolChoice["name"]
	stop := f.stop
	if stop == "" {
		stop = "tool_use"
	}
	json.NewEncoder(w).Encode(map[string]any{
		"id": "msg_test", "type": "message", "role": "assistant", "model": req.Model,
		"content":     []map[string]any{{"type": "tool_use", "id": "toolu_test", "name": tool, "input": f.reply(tool)}},
		"stop_reason": stop, "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": 900, "output_tokens": 120,
			"cache_read_input_tokens": 3000, "cache_creation_input_tokens": 0},
	})
}

func newFake(t *testing.T) (*fakeAPI, *Anthropic) {
	f := &fakeAPI{t: t, reply: func(tool string) map[string]any {
		switch tool {
		case toolTalk:
			return map[string]any{"thought": "  Ada needs to hear this.  ", "words": "It basically runs your whole day!", "listener_thought": "Sounds handy."}
		case toolPost:
			return map[string]any{"thought": "Hype check.", "words": "It's a calendar tweak. #calm", "reader_thoughts": []string{"Fair.", "Boring."}}
		}
		return map[string]any{"reader_thought": "Huh."}
	}}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, NewAnthropic(Config{APIKey: "test-key", BaseURL: srv.URL, Retries: -1})
}

func persona(id int, name string) sim.Persona {
	return sim.Persona{ID: id, Name: name, Age: 30, Shape: sim.ShapeSquare, Traits: []sim.Trait{sim.TraitGullible}, Perception: 50, Interest: 20}
}

func talkScene() sim.Scene {
	return sim.Scene{
		Kind: sim.SceneTalk, Round: 3, Company: "Outrage AI Company",
		Story:   sim.Story{Headline: "Meet Planly", Text: "A calendar assistant.", Claimed: 60, Delivered: 40},
		Speaker: persona(1, "Bob Pickle"), Claim: 72,
		Source:  sim.Source{From: "Cy Rook", Round: 2, Words: "It plans everything for you."},
		Hearers: []sim.Hearer{{Persona: persona(2, "Ada Plum"), DP: 4.2, DI: 9.1, Before: 1}},
	}
}

func TestSpeakTalk(t *testing.T) {
	f, a := newFake(t)
	run := a.Run()
	got := run.Speak(context.Background(), talkScene())
	want := sim.Lines{Thought: "Ada needs to hear this.", Words: "It basically runs your whole day!", Hearers: []string{"Sounds handy."}}
	if got.Thought != want.Thought || got.Words != want.Words || got.Hearers[0] != want.Hearers[0] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	// The same scene again comes from memory: no second request, no second charge.
	run.Speak(context.Background(), talkScene())
	if n := f.requests.Load(); n != 1 {
		t.Fatalf("%d requests, want 1", n)
	}
	if s := run.Summary(); !strings.Contains(s, "1 calls, 1 answered from memory, 0 stub fallbacks") {
		t.Fatalf("summary %q", s)
	}
	if a.spentUSD() <= 0 {
		t.Fatal("no spend recorded")
	}
}

func TestSpeakPostPadsMissingReaders(t *testing.T) {
	_, a := newFake(t)
	s := talkScene()
	s.Kind = sim.ScenePost
	s.Hearers = append(s.Hearers, sim.Hearer{Persona: persona(3, "Di Moss")}, sim.Hearer{Persona: persona(4, "Ed Fern")})
	got := a.Run().Speak(context.Background(), s)
	if got.Words != "It's a calendar tweak. #calm" || len(got.Hearers) != 3 {
		t.Fatalf("got %+v", got)
	}
	// The model gave two reader thoughts for three readers; the third is left for the stub.
	if got.Hearers[0] != "Fair." || got.Hearers[1] != "Boring." || got.Hearers[2] != "" {
		t.Fatalf("reader thoughts %q", got.Hearers)
	}
}

func TestSpeakFallsBackToTheStub(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		stop   string
	}{
		{"server error", http.StatusInternalServerError, ""},
		{"refusal", 0, "refusal"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, a := newFake(t)
			f.status, f.stop = tc.status, tc.stop
			run := a.Run()
			s := talkScene()
			got := run.Speak(context.Background(), s)
			want := sim.StubVoice{}.Speak(context.Background(), s)
			if got.Words != want.Words || got.Thought != want.Thought {
				t.Fatalf("got %+v, want the stub's %+v", got, want)
			}
			// Fallbacks aren't cached: the next try asks the model again.
			run.Speak(context.Background(), s)
			if n := f.requests.Load(); n != 2 {
				t.Fatalf("%d requests, want 2", n)
			}
		})
	}
}

func TestSpeakStopsAfterTheKeyIsRejected(t *testing.T) {
	f, a := newFake(t)
	f.status = http.StatusUnauthorized
	run := a.Run()
	first, second := talkScene(), talkScene()
	second.Round = 4
	run.Speak(context.Background(), first)
	got := run.Speak(context.Background(), second)
	if n := f.requests.Load(); n != 1 {
		t.Fatalf("%d requests after a 401, want 1", n)
	}
	if want := (sim.StubVoice{}).Speak(context.Background(), second); got.Words != want.Words {
		t.Fatalf("got %+v, want the stub", got)
	}
}

func TestSpeakStopsAtTheCallCap(t *testing.T) {
	f, a := newFake(t)
	a.cfg.MaxCalls = 1
	run := a.Run()
	first, second := talkScene(), talkScene()
	second.Round = 4
	run.Speak(context.Background(), first)
	got := run.Speak(context.Background(), second)
	if f.requests.Load() != 1 {
		t.Fatalf("%d requests, want 1", f.requests.Load())
	}
	if want := (sim.StubVoice{}).Speak(context.Background(), second); got.Words != want.Words {
		t.Fatalf("past the cap got %+v, want the stub", got)
	}
	// A new run gets a fresh budget.
	a.Run().Speak(context.Background(), second)
	if f.requests.Load() != 2 {
		t.Fatalf("%d requests, want 2", f.requests.Load())
	}
}

func TestSpeakStopsAtTheSpendCap(t *testing.T) {
	f, a := newFake(t)
	a.spent = a.cfg.MaxUSD
	a.Run().Speak(context.Background(), talkScene())
	if f.requests.Load() != 0 {
		t.Fatal("asked the model past the spend cap")
	}
}

// A whole run through the fake API: every event gets the model's lines, and the numbers stay.
func TestNarrateWithAnthropic(t *testing.T) {
	f, a := newFake(t)
	l, err := sim.Run(1, []string{firstOption(t)}, sim.StubBrain{})
	if err != nil {
		t.Fatal(err)
	}
	run := a.Run()
	if err := sim.Narrate(context.Background(), &l, run); err != nil {
		t.Fatal(err)
	}
	for _, round := range l.Rounds {
		for _, e := range round.Events {
			switch {
			case e.Scroll:
				if e.Thought != "Huh." {
					t.Fatalf("scroll thought %q", e.Thought)
				}
			case e.Post:
				if e.Words != "It's a calendar tweak. #calm" {
					t.Fatalf("post words %q", e.Words)
				}
			default:
				if e.Words != "It basically runs your whole day!" || e.Replies[0] != "Sounds handy." {
					t.Fatalf("talk %q / %q", e.Words, e.Replies)
				}
			}
		}
	}
	if f.requests.Load() == 0 || run.fallbacks.Load() != 0 {
		t.Fatalf("%d requests, %d fallbacks", f.requests.Load(), run.fallbacks.Load())
	}
}

func firstOption(t *testing.T) string {
	t.Helper()
	l, err := sim.Run(1, nil, sim.StubBrain{})
	if err != nil || l.Next == nil {
		t.Fatal(err)
	}
	return l.Next.Options[0].ID
}

func TestSceneText(t *testing.T) {
	text := sceneText(talkScene())
	for _, want := range []string{
		"Round 4 of 50", "Outrage AI Company", "Meet Planly", "Bob Pickle", "Ada Plum",
		`from Cy Rook in round 3: "It plans everything for you."`, "a big deal (claim 72)",
		"opinion goes up noticeably (50 to 54)", "already heard it from one other person", "Call the talk tool.",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("scene text lacks %q:\n%s", want, text)
		}
	}
}

func TestClip(t *testing.T) {
	if got := clip("  héllo wörld  ", 7); got != "héllo…" {
		t.Fatalf("clip = %q", got)
	}
	if got := clip("short", 10); got != "short" {
		t.Fatalf("clip = %q", got)
	}
}

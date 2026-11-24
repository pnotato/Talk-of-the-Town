// Package provider holds the model-backed implementations of interfaces that internal/sim
// defines. The sim never imports it; cmd/server wires it in.
package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"

	"talkofthetown/internal/sim"
)

// DefaultModel is the model CLAUDE.md names for BRAIN=anthropic.
const DefaultModel = "claude-haiku-5-5"

// Config sets up the Anthropic voice. Zero values take the defaults.
type Config struct {
	APIKey   string
	Model    string        // default DefaultModel
	BaseURL  string        // default the SDK's; tests point it at a fake server
	InFlight int           // requests at once, default 16
	Timeout  time.Duration // per request, including retries, default 30s
	Retries  int           // SDK retries on 429, 5xx and connection errors; 0 means 2, negative none
	MaxCalls int           // model calls per run (one Narrate), default 2,500
	MaxUSD   float64       // estimated spend for the server's lifetime, default $5
}

// Model output limits. A talk needs ~100 tokens and a post with 8 readers ~300.
const (
	maxTokens   = 1024
	maxThought  = 200 // characters
	maxWords    = 400
	cacheLimit  = 100_000 // answers kept in memory before the cache is cleared
	coldAfter   = 4 * time.Minute
	logFailures = 5 // failures logged per run; the rest are only counted
)

// Anthropic writes blobs' lines with Claude. It is safe for concurrent use. Answers are kept in
// memory by prompt, so the replays the client asks for (POST /api/run starts from round 0 each
// time) reuse what was already written instead of paying for it again.
type Anthropic struct {
	client anthropic.Client
	cfg    Config
	tools  []anthropic.ToolUnionParam
	sem    chan struct{}

	mu       sync.Mutex
	cache    map[string]sim.Lines
	spent    float64   // estimated USD since the server started
	lastCall time.Time // last call that answered: the prompt cache is probably warm until coldAfter
	refused  string    // set when the API rejects the key: every later call uses the stub

	warm sync.Mutex // held by the first call after a quiet spell, so the rest read its cache
}

// NewAnthropic returns a voice backed by the Messages API.
func NewAnthropic(cfg Config) *Anthropic {
	if cfg.Model == "" {
		cfg.Model = DefaultModel
	}
	if cfg.InFlight <= 0 {
		cfg.InFlight = 16
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.Retries < 0 {
		cfg.Retries = 0
	} else if cfg.Retries == 0 {
		cfg.Retries = 2
	}
	if cfg.MaxCalls <= 0 {
		cfg.MaxCalls = 2500
	}
	if cfg.MaxUSD <= 0 {
		cfg.MaxUSD = 5
	}
	opts := []option.RequestOption{option.WithAPIKey(cfg.APIKey), option.WithMaxRetries(cfg.Retries)}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
	}
	a := &Anthropic{client: anthropic.NewClient(opts...), cfg: cfg, sem: make(chan struct{}, cfg.InFlight),
		cache: map[string]sim.Lines{}}
	for _, t := range toolSchemas {
		a.tools = append(a.tools, anthropic.ToolUnionParam{OfTool: &anthropic.ToolParam{
			Name:        t.name,
			Description: anthropic.String(t.description),
			Strict:      anthropic.Bool(true),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties:  t.properties,
				Required:    t.required,
				ExtraFields: map[string]any{"additionalProperties": false},
			},
		}})
	}
	return a
}

// Run is a Voice for one narration, with its own call budget and tally. Get one per request.
func (a *Anthropic) Run() *Run { return &Run{a: a} }

// Run counts one narration's calls. Its methods are safe for concurrent use.
type Run struct {
	a                                   *Anthropic
	calls, hits, fallbacks              atomic.Int64
	inTok, readTok, writeTok, outTok    atomic.Int64
	usdMicros                           atomic.Int64
	budgetLogged, stopLogged, failCount atomic.Int64
}

// Speak implements sim.Voice. It never fails: a scene it can't get from the model gets
// StubVoice's lines, and those are not cached.
func (r *Run) Speak(ctx context.Context, s sim.Scene) sim.Lines {
	a := r.a
	tool, text := toolFor(s.Kind), sceneText(s)
	key := cacheKey(a.cfg.Model, tool, text)

	a.mu.Lock()
	ln, hit := a.cache[key]
	overSpend, refused := a.spent >= a.cfg.MaxUSD, a.refused
	a.mu.Unlock()
	if hit {
		r.hits.Add(1)
		return ln
	}
	if refused != "" {
		if r.stopLogged.Add(1) == 1 {
			log.Printf("voice: %s; using the stub voice until the server restarts", refused)
		}
		return r.fallback(s)
	}
	if overSpend {
		if r.stopLogged.Add(1) == 1 {
			log.Printf("voice: spend cap reached (~$%.2f of $%.2f); using the stub voice", a.spentUSD(), a.cfg.MaxUSD)
		}
		return r.fallback(s)
	}
	if r.calls.Add(1) > int64(a.cfg.MaxCalls) {
		if r.budgetLogged.Add(1) == 1 {
			log.Printf("voice: %d calls this run, the cap; using the stub voice for the rest", a.cfg.MaxCalls)
		}
		return r.fallback(s)
	}

	select {
	case a.sem <- struct{}{}:
		defer func() { <-a.sem }()
	case <-ctx.Done():
		return r.fallback(s)
	}

	// After a quiet spell the prompt cache may have expired. A cache entry can be read only
	// once the call that writes it has answered, so let one call through first and hold the
	// rest, instead of paying for a write on every call of the first wave.
	a.warm.Lock()
	a.mu.Lock()
	cold := time.Since(a.lastCall) > coldAfter
	a.mu.Unlock()
	if !cold {
		a.warm.Unlock()
	}
	ln, err := r.call(ctx, s, tool, text)
	var apiErr *anthropic.Error
	a.mu.Lock()
	switch {
	case errors.As(err, &apiErr) && (apiErr.StatusCode == 401 || apiErr.StatusCode == 403):
		// A bad key fails every call the same way; stop asking instead of failing 2,000 times.
		a.refused = fmt.Sprintf("the API rejected ANTHROPIC_API_KEY (HTTP %d)", apiErr.StatusCode)
	case err == nil || apiErr != nil:
		// The API answered, so the next calls needn't wait for a cache write.
		a.lastCall = time.Now()
	}
	a.mu.Unlock()
	if cold {
		a.warm.Unlock()
	}
	if err != nil {
		if n := r.failCount.Add(1); n <= logFailures && ctx.Err() == nil {
			log.Printf("voice: round %d %s by %s: %v; using the stub voice", s.Round+1, s.Kind, s.Speaker.Name, err)
		}
		return r.fallback(s)
	}

	a.mu.Lock()
	if len(a.cache) >= cacheLimit {
		a.cache = map[string]sim.Lines{}
	}
	a.cache[key] = ln
	a.mu.Unlock()
	return ln
}

func (r *Run) fallback(s sim.Scene) sim.Lines {
	r.fallbacks.Add(1)
	return sim.StubVoice{}.Speak(context.Background(), s)
}

// call makes one request: the cached tools and system prompt, then the scene, with the scene's
// tool forced and thinking off (the thought is a field of the tool, so it costs a few tokens).
func (r *Run) call(ctx context.Context, s sim.Scene, tool, text string) (sim.Lines, error) {
	a := r.a
	ctx, cancel := context.WithTimeout(ctx, a.cfg.Timeout)
	defer cancel()
	resp, err := a.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     a.cfg.Model,
		MaxTokens: maxTokens,
		System: []anthropic.TextBlockParam{{
			Text:         systemPrompt,
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
		}},
		Tools:        a.tools,
		ToolChoice:   anthropic.ToolChoiceParamOfTool(tool),
		Thinking:     anthropic.ThinkingConfigParamUnion{OfDisabled: &anthropic.ThinkingConfigDisabledParam{}},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortLow},
		Messages:     []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(text))},
	})
	if err != nil {
		return sim.Lines{}, err
	}
	r.record(resp.Usage)
	if resp.StopReason == anthropic.StopReasonRefusal {
		return sim.Lines{}, errors.New("the model declined (refusal)")
	}
	for _, block := range resp.Content {
		if use, ok := block.AsAny().(anthropic.ToolUseBlock); ok && use.Name == tool {
			return parseLines(s, tool, use.JSON.Input.Raw())
		}
	}
	return sim.Lines{}, fmt.Errorf("no %s tool call (stop reason %s)", tool, resp.StopReason)
}

// parseLines turns a tool's input into Lines. Anything blank is left for Narrate to fill from
// the stub, so one bad field doesn't throw away the rest.
func parseLines(s sim.Scene, tool, raw string) (sim.Lines, error) {
	var in struct {
		Thought         string   `json:"thought"`
		Words           string   `json:"words"`
		ListenerThought string   `json:"listener_thought"`
		ReaderThoughts  []string `json:"reader_thoughts"`
		ReaderThought   string   `json:"reader_thought"`
	}
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		return sim.Lines{}, fmt.Errorf("bad %s input: %w", tool, err)
	}
	ln := sim.Lines{Hearers: make([]string, len(s.Hearers))}
	switch tool {
	case toolTalk:
		ln.Thought, ln.Words = clip(in.Thought, maxThought), clip(in.Words, maxWords)
		ln.Hearers[0] = clip(in.ListenerThought, maxThought)
	case toolPost:
		ln.Thought, ln.Words = clip(in.Thought, maxThought), clip(in.Words, maxWords)
		for i := range min(len(ln.Hearers), len(in.ReaderThoughts)) {
			ln.Hearers[i] = clip(in.ReaderThoughts[i], maxThought)
		}
	case toolScroll:
		ln.Hearers[0] = clip(in.ReaderThought, maxThought)
	}
	return ln, nil
}

// clip trims s and cuts it to at most n bytes, on a rune boundary.
func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return strings.TrimSpace(s[:n]) + "…"
}

func cacheKey(model, tool, text string) string {
	h := sha256.Sum256([]byte(promptVersion + "\x00" + model + "\x00" + tool + "\x00" + text))
	return hex.EncodeToString(h[:])
}

// price is USD per million tokens: input, output, cache read, 5-minute cache write.
type price struct{ in, out, read, write float64 }

// prices are the published rates for prompts up to 100K tokens (ours are a few thousand).
// An unknown model is costed at Opus rates, so the spend cap errs on the safe side.
var prices = map[string]price{
	"claude-haiku-5-5":  {0.10, 0.50, 0.01, 0.125},
	"claude-sonnet-5-5": {2, 10, 0.10, 2.50},
	"claude-opus-5-5":   {4, 20, 0.20, 5},
}

func (r *Run) record(u anthropic.Usage) {
	p, ok := prices[r.a.cfg.Model]
	if !ok {
		p = prices["claude-opus-5-5"]
	}
	usd := (float64(u.InputTokens)*p.in + float64(u.OutputTokens)*p.out +
		float64(u.CacheReadInputTokens)*p.read + float64(u.CacheCreationInputTokens)*p.write) / 1e6
	r.inTok.Add(u.InputTokens)
	r.outTok.Add(u.OutputTokens)
	r.readTok.Add(u.CacheReadInputTokens)
	r.writeTok.Add(u.CacheCreationInputTokens)
	r.usdMicros.Add(int64(usd * 1e6))
	r.a.mu.Lock()
	r.a.spent += usd
	r.a.mu.Unlock()
}

func (a *Anthropic) spentUSD() float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.spent
}

// Summary is one log line about this run's calls and cost.
func (r *Run) Summary() string {
	calls := min(r.calls.Load(), int64(r.a.cfg.MaxCalls))
	return fmt.Sprintf("%s: %d calls, %d answered from memory, %d stub fallbacks; tokens in %d, cache read %d, cache write %d, out %d; ≈$%.4f (server total ≈$%.2f of the $%.2f cap)",
		r.a.cfg.Model, calls, r.hits.Load(), r.fallbacks.Load(), r.inTok.Load(), r.readTok.Load(), r.writeTok.Load(), r.outTok.Load(),
		float64(r.usdMicros.Load())/1e6, r.a.spentUSD(), r.a.cfg.MaxUSD)
}

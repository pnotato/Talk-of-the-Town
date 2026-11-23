# Thinking

How to give each of the 100 blobs an LLM brain with a persona, at the lowest cost that still lets them reason a little and call tools.

Status: **proposal, nothing implemented.** Researched 2026-11-22. Prices change often, so re-check them before you budget.
Numbers marked *(measured)* come from running the current Go sim. Numbers marked *(estimate)* are token guesses to replace with real `usage` logs once a provider exists.

# Summary

- **Money is not the hard part. Latency, rate limits and determinism are.** On Claude Haiku 5.5 with prompt caching, a full 50-round run where every talk, post and listener reaction is an LLM call costs about **$0.40–$1.00** *(estimate)*. The real problems are that the sim currently runs talks one after another within a round, that every `POST /api/run` replays the run from round 0, and that model output isn't reproducible.
- **Recommended setup (options A2 + B1/B2 + C1 below):**
  1. The formula sim stays the source of truth.
  2. The model picks **bounded, categorical choices** that nudge the formula (how hard to spin a retelling, how much to believe it), plus a short line of speech and a one-line thought.
  3. It does this through **one strict tool call per event**. There is no multi-step agent loop.
  4. All 100 blobs share **one cached prefix**: tools, rules, the six shape cultures, the trait glossary and few-shot examples. Only a ~100-token persona card plus memory and situation is uncached.
  5. Each round fans out in parallel from a snapshot of the round's starting state.
  6. Every response goes on a **tape** on disk, so replays cost $0 and give the same answer.
- **Cheapest overall, if the game uses a few fixed towns:** precompute the whole game tree offline. With the current 3–4 options per story, one seed has 471 ten-round chunks. That's about $17–75 per town, done once, and live play then costs $0 with zero wait. See [#precomputed-game-tree](#precomputed-game-tree).
- **Don't** give every blob a turn every round with a free-running tool loop. That's ~11,000+ calls per run, rate-limit storms, and the least control over the game's balance.

# The workload

How often blobs actually act, from the current Go sim (`sim.Run`, stub brain, seeds 1–10, every option the same) *(measured)*:

| Per run (50 rounds) | All-honest choices | All-bold choices |
|---|---:|---:|
| Talks (1 teller, 1 listener) | 1,319 | 1,503 |
| Posts (1 author) | 564 | 644 |
| Post readers (8 per post) | 4,515 | 5,150 |
| Scrolls (1 reader) | 237 | 222 |
| Events per round, mean | 42 | 47 |
| Events in the busiest round | 71 | 68 |

So there are about **2,000 "speaking" moments** (talk or post) and about **6,500 "hearing" moments** per run. Blobs that haven't heard the story, or that idle, need no call.

How many calls a run needs depends on who gets one:

| Level | Who calls the model | Calls per run |
|---|---|---:|
| L0 | Nobody (stub, today) | 0 |
| L1 "voices" | Each talk and post: the teller decides how to retell and says a line | ~2,000 |
| L2 "voices + reactions" | L1, plus listeners react: the talk call covers both blobs, each post gets one "reader panel" call for its 8 readers, and each blob gets one reflection per story | ~3,300 |
| L3 "full agents" | Every blob decides every round, plus every hearing | ~11,400 |

# What a call costs

Claude Haiku 5.5 rates for prompts of 100K tokens or less: $0.10 per million input tokens and $0.50 per million output tokens. Cache reads are 0.1× input ($0.01). 5-minute cache writes are 1.25× ($0.125), and 1-hour writes are 2×. The minimum cacheable prefix is 512 tokens. Thinking tokens bill as output.

One L1 call: 3,000-token shared prefix + 800-token per-blob tail + 150 output tokens *(estimate)*:

| Part | Tokens | Cached | Uncached |
|---|---:|---:|---:|
| Shared prefix (tools + system) | 3,000 | $0.000030 | $0.000300 |
| Per-blob tail (story, persona, memory, situation) | 800 | $0.000080 | $0.000080 |
| Output (one tool call + a line) | 150 | $0.000075 | $0.000075 |
| **Total** | | **$0.000185** | **$0.000455** |

What follows from this:

1. **Caching cuts the bill by about 60%**, and after that **output is the biggest cost**. Keep outputs small: enums, a ≤30-word line, and thinking off by default.
2. Putting more into the cached prefix (few-shot examples, glossaries, shape cultures) is almost free. 1,000 extra cached tokens cost $0.00001 per call.
3. Packing many blobs into one call saves very little here. It saves only prefix reads, which already cost $0.00003. See [#b-how-calls-are-packed](#b-how-calls-are-packed).

Per run, Haiku 5.5:

| Level | Calls | Cached | + light thinking (~150 tok) | No caching | Cached + Batch API (−50%) |
|---|---:|---:|---:|---:|---:|
| L1 | 2,000 | **$0.37** | $0.52 | $0.91 | $0.18 |
| L2 | 3,330 | **$0.78** | $1.03 | $1.68 | $0.39 |
| L3 | 11,430 | $1.95 | $2.81 | $5.04 | $0.98 |

For comparison, Claude Sonnet 5.5 is $2 / $10 per million tokens, so it's 20× these figures. Use it only for rare, high-value calls, if at all.

For a reality check, the [agent-economy](https://github.com/leakyhose/agent-economy) reference project reports $1.33 for 3,059 calls on an OpenAI model (gpt-5.6-luna). That's about $0.00043 per call, roughly twice our cached Haiku estimate.

# Options

There are three independent choices: **what** the model decides, **how** calls are packed, and **where** the model runs.

## A. What the model decides

| Option | Model output | Pros | Cons |
|---|---|---|---|
| A1. Flavour only (the current `Brain` contract) | Text only. The numbers come from MODEL.md#drift. | Zero balance risk. The research-cited math is untouched. Works with any model. | The blobs don't really think: their words change nothing. |
| **A2. Bounded choices (recommended)** | Enums that scale existing formula terms, plus a line of text | Persona-driven variety with hard limits. The formula is still the baseline, so the MODEL.md sanity table stays meaningful. Small models handle enums reliably. | Needs a calibration pass (reaction mix per trait). MODEL.md#drift must change: it currently says the model may not change the number. |
| A3. Full control | New perception/interest numbers, partner choice, whether to act | The most "alive" option | LLMs give poorly calibrated numbers and lean towards truth and consensus (see [#risks](#risks)). Balance becomes untestable. It costs the most. |

A sketch of A2 *(design; numbers to calibrate)*:

| Choice | Values → effect |
|---|---|
| Teller `spin` | `downplay` −4, `faithful` 0, `embellish` +3, `exaggerate` +6, **added on top of** `sharpen` (+3 talk / +5 post) in MODEL.md#drift. The result is still clamped to 0–100. |
| Listener `reaction` | `dismiss` ×0.6, `doubt` ×0.8, `unsure` ×1.0, `believe` ×1.2, `convinced` ×1.4 on `k` in MODEL.md#influence. `alpha` is still capped at 0.50. |
| Listener `share` | `no` / `maybe` / `yes`. This nudges next round's `pActive` by −0.05 / 0 / +0.05. |
| Reflection `stance` | One sentence kept in memory. It changes no number. |

**The formula sets the baseline and the model only nudges it.** The research is clear on why ([#risks](#risks)):

- LLM agents drift towards the truth whatever their persona says.
- Retold stories drift towards bland, not hype.
- Populations of LLM personas collapse into a few response types.

If the model set the scores, gullible blobs wouldn't reliably believe hype and the core mechanic would fade. So `cred`, `pers`, trust, channel, repeat and credibility all stay in Go. `sharpen` keeps pushing claims up by default, and the model's enums move results by about ±40% around that. The persona still names the blob's credulity so the words and thoughts match. The small double count is deliberate and is tuned in calibration *(design)*.

## B. How calls are packed

| Option | Calls per round | Pros | Cons |
|---|---:|---|---|
| **B1. One call per event (recommended)** | ~40–50, in parallel | Clean persona isolation and natural tool calls. A failure loses one event, not a round. | Needs a rate-limit tier that allows ~1,000+ requests per minute, or a concurrency cap. |
| B2. One call per scene: one talk with both blobs, or one post with its 8 readers | ~40–50, with fewer total calls (this is how L2 stays at ~3,300 calls) | Listener reactions without extra calls or latency. Reader panels have small outputs (8 enums). | Two personas in one prompt is a little less independent. |
| B3. One call speaks for many blobs, e.g. a whole neighbourhood or the whole round | 1–5 | Very few requests, so it fits a low rate limit. Saves the per-call prefix. | Barely cheaper on Haiku with caching (the outputs are the same). One long generation is slower than many parallel short ones. Personas blur into one voice. One bad output loses many blobs. |
| B4. Archetypes: one call per (shape × credulity × age) group, reused by its members | ≤ 54 types, fewer in practice | Scales to 10,000+ agents | At 100 blobs it saves little and erases individuality, which is the point of this feature |

Recommendation: **B1 for tellers and B2 for listeners.** Use B3 only as a fallback if the account is stuck on a low rate-limit tier.

## C. Where the model runs

| Option | Cost per run | Pros | Cons |
|---|---|---|---|
| **C1. Claude Haiku 5.5, live, cached (recommended)** | $0.37–$1.03 (L1–L2) | Already the project default (`BRAIN=anthropic`). Strict tool use, 512-token cache minimum, Go SDK. | Needs an API key, a rate-limit tier and the tape. |
| C2. Claude Haiku 5.5 through the Message Batches API | −50% | Discount stacks with caching | Results come back asynchronously, so it can't serve a player who is waiting. Use it for offline jobs only. |
| C3. Precomputed game tree (C1 or C2, run offline) | $0 live; about $17–75 once per town | Zero live cost and zero wait. Fully deterministic. Every line can be reviewed before players see it. | Only fixed, curated seeds. Prompt changes mean recomputing. See [#precomputed-game-tree](#precomputed-game-tree). |
| C3b. Speculative: while the player reads the options, compute the next 10 rounds for every option in parallel | ≈ 3× C1 ($1.10–$2.40) | No wait on any seed. The unused branches go on the tape for later players. | Pays for branches nobody picks. Triples the burst rate at each decision. |
| C4. Other cloud models | See [#provider-comparison](#provider-comparison) | Some are cheaper per token | Breaks the project's single-provider assumption. Tool-call quality varies. |
| C5. Local model (llama.cpp / Ollama / MLX) | $0 | Free and offline. Good for prompt iteration in dev. | Slow on a laptop for ~2,000–3,000 calls per run. Small models are weaker at tool calls and at holding a persona. See [#provider-comparison](#provider-comparison). |

## Precomputed game tree

With the tape, a run is a pure function of `(seed, choices)`. Chunk `k` (rounds `10k` to `10k+9`) depends only on the first `k+1` choices. The current content has 3, 3, 3, 4 and 3 options for the five stories, so one seed has exactly `3 + 9 + 27 + 108 + 324 = 471` distinct ten-round chunks. That is 4,710 rounds, or about 94 runs' worth.

| Level | Live API, cached | Batch API, cached |
|---|---:|---:|
| L1 | ≈ $35 per seed | ≈ $17 per seed |
| L2 | ≈ $73 per seed | ≈ $37 per seed |

Each extra option on a story multiplies the chunks after it, so keep the option counts small.

- Run it breadth-first: round `r` of every path at a given depth goes in one batch. That's 100 sequential batches (50 rounds × 2 waves) at most, which is fine as an overnight job.
- The result is just a full tape (see [#tape](#tape)), so live and precomputed play use the same code path. A curated seed is a tape that's already full.
- It also makes [CLAUDE.md](../CLAUDE.md) hard rule 3 easier: a person or a script can check every generated line for real names before shipping.
- Recommended product shape: **3–5 curated towns, fully precomputed**, plus an optional "random town" that runs live.

# Recommended design

## Prompt layout

```
tools     say, post, react, reflect          (fixed, sorted by name, strict)   ┐ cached once,
system    world + company (Outrage AI Company)                                 │ shared by all
          how blobs behave; what each choice means                             │ 100 blobs and
          the six shape cultures; the trait glossary; voice guide by age       │ every round
          10–20 few-shot examples (one per reaction level and trait)           │ (~2.5–4K tokens)
          ── cache_control: ephemeral (5 min) ──                               ┘
user      current story: headline + text (changes every 10 rounds)            ┐ not cached
          persona card: "Bob Pickle, 20, Triangle. skeptic, recluse.           │ (~600–1,000 tokens)
                         Lives alone, neighbourhood 3. Quirk: …"               │
          memory (see below)                                                   │
          situation: "Ada (Square, your age) just told you: '…'"               ┘
```

- **One breakpoint, at the end of the system prompt.** Everything above it must be byte-identical for every blob and every round. That means no round number, no blob name and no timestamp. Tools render first, so the tool list must never vary per blob.
- **Put every shared piece in the prefix and refer to it by key in the tail.** For example, the persona says "Triangle", and the cached system prompt explains what Triangles are like. This keeps the uncached tail small.
- **The story goes in the tail, not behind a second breakpoint.** It changes every 10 rounds and is only ~150 tokens ($0.000015 per call), so caching it separately isn't worth the extra moving part.
- **Pre-warm once per run** with a `max_tokens: 0` request (no forced `tool_choice`; that combination is rejected). A cache entry is readable only after the first response starts streaming, so a cold 50-call fan-out would pay for 50 writes. If the player pauses for more than 5 minutes between stories, the next wave pays one cold write (~$0.0004). The 1-hour TTL isn't worth its 2× write price.
- **Check `usage.cache_read_input_tokens > 0` in an integration test.** A cache that silently stops working costs money without any error.

## Personas

- Build the persona card in Go from the blob's own fields: name, age, shape, tags, family/leader/recluse, home and neighbourhood. No model call is needed, and it's deterministic.
- For variety at no extra cost, add a seeded **quirk** drawn from a fixed, reviewed list (e.g. "talks about their garden", "uses lots of exclamation marks") and a speech style by age group. Fixed lists stay fictional and reviewable.
- Optional richer backstories: generate a library once (Batch API, ~100 × 300 output tokens ≈ $0.01) and check it into `internal/sim/content/`. Don't generate them per run.
- Don't give each blob its own cached system prompt. A blob acts only every ~2.5 rounds, so its 5-minute entry would often expire, and the saving is about 300 tokens × $0.09 per million per call.

## Tools

Use tools as the **action vocabulary, not as an agent loop.** Each call is one request and one tool call, executed by the Go sim.

```jsonc
// all strict: true, additionalProperties: false
say     { "thought": "≤12 words", "spin": "downplay|faithful|embellish|exaggerate", "words": "≤30 words" }
post    { "thought": "≤12 words", "spin": "…", "words": "≤40 words" }
react   { "thought": "≤12 words", "reaction": "dismiss|doubt|unsure|believe|convinced", "share": "no|maybe|yes" }
reflect { "stance": "≤25 words", "mood": "angry|let-down|meh|pleased|excited" }
```

- The **`thought` field comes first** in each schema, so the model writes a one-line reason before it picks. It's a cheap, visible stand-in for chain-of-thought, and the UI can show it as a thought bubble.
- The sim decides which tool fits (talking → `say`, hearing → `react`). It validates the result in Go and falls back to the stub formula for that event if the call is missing, invalid, refused or late.
- Avoid lookup tools like `recall(topic)`. Each tool round trip re-sends the whole prompt and doubles latency. Put the memory in the prompt instead.
- Haiku 5.5 accepts a forced `tool_choice` (`any`), but then skips thinking. Plain `auto` plus "call exactly one tool" also works, and keeps the pre-warm request identical to real traffic.

## Memory

Memory is written by the sim, not the model. It's rendered as ≤ 400 tokens:

- The current story as the blob last heard it: the actual words, who said them, how many sources.
- Its stance sentence from the last `reflect`.
- Its last 3 hearings, ≤ 15 words each.
- One line per past story: what it heard versus what shipped ("Wick Health: heard 'replaces your doctor', got a notepad. Felt let down.").

That gives the telephone game real text. Each retelling passes along the words it heard, so the distortion shows up as text the player can read, not just as a number.

A **reflection** happens once per story, at ship time (rounds 8, 18, …), for blobs that heard the story: up to 500 calls per run, about $0.10. It updates the stance line. This is the cheap version of the reflection step in Generative Agents. At this scale there's no need for a vector store.

## Thinking

- **Default: thinking off** (`thinking: {type: "disabled"}` with effort `low`; Haiku 5.5 accepts disabled at `high` or below). The `thought` field does the "somewhat think" job. agent-economy measured Haiku at low effort taking 3.9 s instead of 2.0 s per decision, and costing ~30% more, with no better results in their game.
- **Optional tier:** adaptive thinking at effort `low` for the 6 leaders and for reflections only. That's about +$0.05 per run. Measure before turning it on for everyone.
- Thinking tokens count against `max_tokens`. Use about 400 with thinking off and about 1,500 with it on.

## Round flow

Today `act(b)` runs in id order and applies each hearing immediately, so a blob told something early in a round can retell it the same round (MODEL.md#round-order). With model calls, that serialises ~45 calls per round: about 90 s per round, or more than an hour per run.

Proposed change *(design; needs a MODEL.md update and new golden runs)*:

1. **Plan.** From the round's starting state, draw every action, partner and reader in id order, as now.
2. **Wave 1, in parallel:** tellers and post authors (`say` / `post`, with the listener's `react` included for talks under B2).
3. **Wave 2, in parallel:** reader panels for this round's posts, and scrolls.
4. **Apply** all results in id order, then decay.

The cost: news can't hop twice in one round. Each round then takes about the slowest call per wave, roughly 2–4 s. That's about 5–8 s per round, or 50–80 s per 10-round chunk *(estimate)*.

To hide even that, **stream rounds to the client** (NDJSON or SSE) so the replay of round `r` plays while round `r+1` computes. A round's animation is already several seconds long.

## Tape

This is required, not optional:

- **Replays.** `POST /api/run` re-simulates from round 0 for each new choice. Without a tape, chunk 1 would be paid for 5 times, chunk 2 four times, and so on: 3× the calls. Worse, rounds the player already watched would come out differently.
- **Determinism.** Haiku 5.5 rejects `temperature`, so identical prompts can give different answers.

Design:

- Key: `sha256(model ‖ request JSON)`, using deterministic serialisation. Value: the tool input, `usage`, and whether the stub fallback was used.
- Storage: content-addressed files under `RUNS_DIR/brain/`. Identical prompts from different players share an entry, so popular openings are paid for once.
- Modes: `BRAIN=anthropic` records misses and replays hits. A new `BRAIN=tape` replays only and treats a miss as an error. CI uses `stub` or a committed tape, so it costs $0, which satisfies CLAUDE.md hard rule 2.
- The `Brain` interface in `internal/sim` becomes batch-shaped, roughly `Think(ctx, []Situation) []Decision` per wave. `internal/sim` stays I/O-free, and the provider and the tape do the I/O.

## Spend caps

This extends CLAUDE.md hard rule 5. The server refuses or degrades a run past any of these limits:

| Cap | Suggested | On hit |
|---|---|---|
| `MAX_CALLS_PER_RUN` | 4,000 | Remaining events use the stub formula |
| `MAX_USD_PER_RUN` (from `usage`, including cache tokens) | $2.00 | Same |
| `max_tokens` per call | 400 (thinking off) | The call fails and that event uses the stub |
| `MAX_IN_FLIGHT` | 16–64, matched to the rate-limit tier | Calls queue |
| Per-call timeout | 10 s | That event uses the stub |

Retry 429 and 529 responses with `retry-after` plus jitter, up to 3 times. Log tokens per call so `/api/run` can report each run's cost.

## Latency and rate limits

- **Peak demand** is one wave of ~50 calls. If each takes ~2 s, that's a burst rate of ~1,500 requests per minute. agent-economy hit 429s at ~1,000 calls/min with 100 agents.
- **Anthropic's Start tier** allows 4,000 requests per minute, 2M input tokens per minute and 400K output tokens per minute, with a $500/month spend cap. That covers us. Cache reads don't count towards the input-token limit.
- **New organisations** may begin on a lower "Evaluation" tier, and sudden bursts can hit separate ramp-up limits. So keep `MAX_IN_FLIGHT` (16 in flight gives about 6–7 s per wave) and retry on 429.
- **If the account is stuck on a low tier,** B3 (one call per neighbourhood) keeps the request count at ~5–10 per round. That trades persona quality for fewer requests.
- **Strict tools add latency the first time a new schema is used.** Compiled schemas are cached for 24 hours, so the pre-warm also absorbs that cost.

# Risks

- **LLMs lean towards truth and consensus.** Agents tend to drift to the accurate view even when told to be gullible, which would weaken the core hype mechanic. Mitigation: A2's bounded enums over the formula baseline, explicit persona instructions (this is a fictional game, and gullible people believe their friends), few-shot examples for every reaction level, and a calibration check on the reaction mix for each trait.
- **Personas blur into one voice.** Even detailed personas collapse into a few response types, and the models most faithful to each persona give the *least* diverse populations. Mitigation: per-shape voice guides, a speech style by age, seeded quirks, and B1 over B3. Above all, keep the variety in Go-side numbers and seeded noise rather than expecting it from the model.
- **Retold stories go bland.** When LLMs retell a story along a chain, it drifts towards "attractors" (calmer, less extreme), the opposite of hype. Mitigation: `sharpen` stays in Go as the baseline, and the model's `spin` is an offset on top of it. Watch the `spin` mix per trait in calibration.
- **Herding.** LLM agents conform to perceived peer pressure more than people do. OASIS found its agents herd more than humans. Mitigation: Go owns the update rule, and the `react` prompt shows only what this one speaker said, never a town-wide tally.
- **Real names leak.** The model may mention real companies or people, which breaks hard rule 3. Mitigation: the instruction, plus a Go denylist check. On a hit, drop the text and keep the numbers.
- **Refusals.** Haiku 5.5 safety classifiers can decline a request (`stop_reason: "refusal"`) and have no server-side fallback. A health story ("Wick Health replaces your doctor") is benign, but handle refusals anyway with the stub fallback, recorded on the tape.
- **Runaway spend.** Covered by [#spend-caps](#spend-caps).

# Provider comparison

These figures are for a simpler L1-shaped workload than the tables above: 2,000 calls × (3,000 cacheable prefix + 500 uncached) input + 150 output. Prices are USD per million tokens, checked on official pricing pages on 2026-11-22.

| Option | In / Out | Cached read | No cache | Cached | Cached + batch |
|---|---|---|---:|---:|---:|
| **Claude Haiku 5.5** | 0.10 / 0.50 | 0.01 | $0.85 | **$0.31** | $0.16 |
| Claude Sonnet 5.5 | 2.00 / 10.00 | 0.10 | $17.00 | $5.64 | $2.82 |
| OpenAI gpt-6-luna | 0.10 / 0.50 | 0.01 | $0.85 | $0.31 | $0.16 (Batch or Flex) |
| OpenAI gpt-5-nano (deprecated) | 0.05 / 0.40 | 0.005 | $0.47 | $0.20 | $0.10 |
| Gemini 2.5 Flash-Lite | 0.10 / 0.40 | 0.01 | $0.82 | $0.28 | $0.17 |
| Gemini 3.5 Flash-Lite | 0.30 / 2.50 | 0.03 | $2.85 | $1.23 | $0.62 |
| DeepSeek flash (off-peak) | 0.15 / 0.60 | 0.003 | $1.23 | $0.35 | no batch API |
| Groq gpt-oss-20b | 0.075 / 0.30 | 0.0375 | $0.62 | $0.39 | $0.31 |
| Fireworks gpt-oss-120b | 0.15 / 0.60 | 0.015 | $1.23 | $0.42 | ? |
| Local Mac (llama.cpp / Ollama) | $0 | n/a | $0 | $0 | n/a |

What this means:

- **Among hosted options, the choice of provider changes the bill by cents.** Haiku 5.5, gpt-6-luna and Gemini 2.5 Flash-Lite are all about $0.30 per run with caching. So choose on tool-call quality, latency and Go support. Haiku 5.5 is already the project default (CLAUDE.md hard rule 2), has `strict` tools and an official Go SDK (`anthropic-sdk-go`), and its 512-token cache minimum is the lowest here.
- **Caching minimums differ.** OpenAI's is 1,024 tokens. Gemini 3.x and 4 have an implicit minimum of 4,096, so a 3K prefix would not cache there without padding.
- **Thinking can cost more than everything else.** 500 thinking tokens per call is +$0.50 per run on Haiku, more than the whole cached run. The same goes for `reasoning_effort` on OpenAI and DeepSeek's thinking mode.
- **Batch is offline only.** Anthropic batches mostly finish within an hour, with a 24-hour maximum, and cache hits inside a batch are best-effort (30–98%). Gemini Flex has a 1–15 minute target. OpenAI Flex is the only synchronous half-price tier, and it can return 429 when it's out of capacity.
- **Local models are too slow to play with.** The best small tool-callers are Qwen3 8B and 14B, with tool-selection F1 of 0.92–0.97 against 0.79–0.84 for Llama 3.1 8B. A 7B Q4 model runs at about 50 tokens/s of generation on an M4 Pro, ~80 on an M4 Max and ~120 on an M5 Max. With llama.cpp's per-slot prefix reuse (`cache_prompt`, `-np` slots), one run is roughly **1 hour on an M4 Pro** (12–15 minutes per 10-round chunk) and about 3–4 minutes per chunk on an M5 Max *(estimate)*. That's fine for offline prompt iteration as a `BRAIN=local` provider over llama.cpp's OpenAI-compatible server, but not for live play. Small models also call tools wrongly more often. In When2Call, Llama-3.2-3B called a tool in 52% of cases where none fit.

# Prior art

| System | Scale | What made it cheap (or expensive) | Lesson for us |
|---|---|---|---|
| Generative Agents / Smallville (Park 2023) | 25 agents, 2 game days | "Thousands of dollars" and days of runtime: free-text calls at every step (observe, retrieve, reflect, plan hourly, turn-by-turn dialogue) | Don't put the model in every step. Reflection is worth keeping as a rare, cheap step. |
| Affordable Generative Agents (Yu 2024) | 25 agents | Reuse plans the model already wrote when a new one matches closely (*lifestyle policy*). Keep a short memory per partner (~100 tokens instead of ~2,000). Uses 31–43% of baseline tokens. | Short memory written by the sim. Reuse answers through the tape. |
| Lyfe Agents (2023) | Small town | The model picks a high-level option and cheap checks decide when it ends. Memory is summarised and old items dropped. About $0.50 per agent-hour, 10–100× cheaper than Smallville. | Use the model at decision points only. |
| LLM Archetypes / AgentTorch (Chopra 2025) | 8.4M agents | One query per archetype group, and agents sample from its answer. ~400 queries in all, 95% less runtime, and *better* calibration than one model per agent. | Option B4. Not needed at 100 blobs, but a good fallback. |
| AgentSociety (2025) | 10k+ agents | A hybrid: mobility uses a gravity model and the economy uses standard formulas, "to reduce LLM overhead". Calls are async. | Formula sim plus model calls is the standard pattern at scale. |
| OASIS (CAMEL-AI 2024) | Up to 1M agents | A local Llama-3-8B on vLLM. Per-agent activation chances leave most agents idle each step. | Idle blobs make no calls, as we already have it. Agents herd more than humans. |
| GenSim, GA-S3 | 100k / clusters | "Script mode" writes a whole exchange in one call. Group agents stand in for many users. | Cheaper per token, but the quality evidence goes against it for us (B3). |
| TinyTroupe (Microsoft 2025) | n/a | Caches every model input→output pair and checkpoints the sim | The tape. |
| Chuang et al. (NAACL Findings 2024) | Opinion dynamics | Agents drift to the factual answer whatever their persona. Confirmation-bias prompts widen the spread of opinions but don't stop the drift. | Go owns the scores (A2). |

Putting many agents in one prompt measurably hurts behaviour. In one study, single-call play matched human behaviour 50% of the time, against 87.5% for separate agents. That's why B3 is a fallback only.

# Phased plan

1. **Sim refactor, no API.** Batch-shaped `Brain`, plan and waves per round, the tape, the stub behind the same tools. New golden runs. Cost $0.
2. **L1 on Haiku 5.5.** `say` / `post` only, with the cached prefix, the pre-warm, the caps and usage logging. Measure $/run, cache hit rate and seconds/round on 5 seeds.
3. **L2.** `react` (scene calls), reader panels and reflections, with the `spin` and `reaction` enums wired into the formula.
4. **Calibrate** against the MODEL.md sanity table. Tune the enum multipliers, the prompts and the few-shot examples.
5. **Ship.** Precompute 3–5 curated towns; live play for random seeds. Optional thinking tier for leaders.

# Open decisions

1. Can the model move numbers within bounds (A2), or only write flavour text (A1, the current MODEL.md#drift)?
2. Is it OK to change the round order to plan-then-apply, so news can no longer hop twice in one round?
3. Curated precomputed towns, live random towns, or both?
4. Which rate-limit tier will the API key be on? This decides B1 versus B3 and the `MAX_IN_FLIGHT` value.
5. Should blobs' words and thoughts show up in the UI (speech and thought bubbles), or stay in the log only?

# Sources

- Claude API docs: prompt caching, pricing, Message Batches, strict tool use, Claude Haiku 5.5 notes. platform.claude.com/docs (pricing, build-with-claude/prompt-caching, build-with-claude/batch-processing, api/rate-limits, build-with-claude/structured-outputs).
- Other providers, fetched 2026-11-22: aistudio.google.com/docs/pricing and /docs/caching; developers.openai.com/api/docs/pricing and /guides/prompt-caching; api-docs.deepseek.com/quick_start/pricing; console.groq.com/docs/models; fireworks.ai/pricing; together.ai/pricing; openrouter.ai.
- Local inference: github.com/ggml-org/llama.cpp (server README; Apple Silicon benchmarks, discussion 4167); docs.ollama.com/faq; docker.com/blog/local-llm-tool-calling-a-practical-evaluation.
- agent-economy: https://github.com/leakyhose/agent-economy (commit d98115a): `backend/src/brains/chat.mjs`, `brains/prompt.mjs`, `tools.mjs`, `world.mjs`, `server.mjs`, README cost notes.
- Generative Agents: https://arxiv.org/abs/2304.03442
- Affordable Generative Agents: https://arxiv.org/abs/2402.02053
- Lyfe Agents: https://arxiv.org/abs/2310.02172
- LLM Archetypes / AgentTorch: https://arxiv.org/abs/2409.10568
- AgentSociety: https://arxiv.org/abs/2502.08691
- OASIS: https://arxiv.org/abs/2411.11581
- GenSim: https://arxiv.org/abs/2410.04360. GA-S3: https://arxiv.org/abs/2506.03532
- TinyTroupe: https://arxiv.org/abs/2507.09788
- Chuang et al., opinion dynamics with LLM agents: https://arxiv.org/abs/2311.09618
- Telephone-game attractors: https://arxiv.org/abs/2407.04503
- Conformity in LLM agents: https://arxiv.org/abs/2405.03862
- Persona collapse: https://arxiv.org/abs/2604.24698 (2026 preprint), https://arxiv.org/abs/2402.01908
- Single call vs separate agents: https://arxiv.org/abs/2402.08189
- Small-model tool calling (When2Call): https://arxiv.org/abs/2504.18851

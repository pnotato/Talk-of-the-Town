# Thinking

How the blobs show their thought process: an LLM writes what each blob thinks, says and posts, while the simulation keeps deciding everything that happens.

Status: **prototype, built and tested without a key.** Off by default; `BRAIN=anthropic` turns it on. Prices change often, so re-check them before you budget.
Numbers marked *(measured)* come from the current Go sim. Numbers marked *(estimate)* are token guesses; replace them with the server's `voice:` log line once a key is in use.

# Summary

- **The simulation stays a traditional simulation.** Go makes every roll: who acts, who they meet, how strong the claim is, and how every score moves ([MODEL.md](./MODEL.md)). Nothing a model writes changes a number, so runs stay deterministic and the golden tests still hold.
- **After the run, a voice writes the words.** For each talk, post and scroll it writes:
  - the speaker's **thought**: why they pass it on
  - their **words**: what they say, or the post itself
  - each listener's or reader's **thought**: how they took it

  The model is told what the sim decided (whose opinion went up, by how much), and its job is to explain it in character.
- **The telephone game is real text.** Each retelling is given the exact words its teller last heard, so the player can read the story drift from blob to blob.
- **One cheap call per event.** Claude Haiku 5.5, one strict tool forced per call, thinking off, and one cached system prompt shared by every call. About 2,000 calls and **about $0.25 per full run** *(estimate)*.
- **Replays are free.** The client replays from round 0 after every choice. The provider keeps every answer in memory by prompt, so only new rounds cost anything.
- **No key, no change.** The default stub voice writes template lines from the same numbers, so the feed's Social tab and the blob card work today.

# What the player sees

- **Feed → Social:** every post so far, newest first, with why the author posted it and the first readers' reactions as comments. **All** mixes posts with the company's announcements and ships.
- **Blob card:** for the round on screen, what the selected blob **heard** (or read), what it **thinks**, and what it **said** (or posted).

# How it works

```
POST /api/run {seed, choices}
  sim.RunMap      the formulas play the rounds: every event and every score   (deterministic)
  sim.Narrate     a Voice writes w / t / r on every event                     (text only)
  → RunLog JSON   rounds[].events[] = {f, to, p, s, c, dp, di, w, t, r}
```

- **`internal/sim/voice.go`**:
  - The `Voice` interface: `Speak(ctx, Scene) Lines`.
  - `Narrate`: builds a scene per event and asks the voice for its lines.
  - `StubVoice`: the template lines.
  - The sim does no I/O.
- **`internal/provider`**:
  - `Anthropic`: the model-backed voice.
  - `VoiceFromEnv`: picks the voice from `BRAIN`.
  - `cmd/server` wires the chosen voice into `server.New`.
- **What a scene holds:**
  - the event's kind, round and claim strength
  - the story (feature, headline, the company's text, and whether it has shipped)
  - the speaker and each hearer, with name, age, shape, traits and scores
  - each hearer's change in perception and interest, and how many others had already told it
  - what the speaker last heard, and from whom
- **The event fields** ([RUN_LOG.md](./engine/RUN_LOG.md)):
  - `w`: the words said or posted. For a scroll, the post that was read.
  - `t`: the actor's thought.
  - `r`: each hearer's thought, one per `to`.

## Scheduling the telephone game

A retelling can't be written until the words it repeats exist. `Narrate` walks the run once, in the order the sim played it, and gives each event at most one dependency:
- **A talk or post** depends on the event its teller last heard the story from. If there is none, the teller heard it from the company, and the company's announcement is the source.
- **A scroll** depends on the post it read.

Every event then starts as soon as its dependency is written. Chains restart with each story, so a run is only as slow as its longest chain of retellings, not its number of rounds:

| Seed 1, first option of every story *(measured)* | |
|---|---:|
| Events narrated | 1,972 (1,240 talks, 484 posts, 248 scrolls) |
| Retellings of words heard earlier the same round | 38% |
| Longest chain of retellings in one story | 18 calls |

## What the model sees

```
tools     post, scroll, talk          (fixed order, strict)                  ┐ cached once, shared by
system    the game, the job, the scales, the shape cultures, the traits,     │ every call of every run
          voice by age, lengths, rules, three examples                        │ (~1,850 tokens)
          ── cache_control: ephemeral (5 min) ──                             ┘
user      one scene: round, company, story, who is involved, what they       ┐ not cached
          last heard, and what the sim decided (e.g. "Ada's opinion goes     │ talk ~300, post ~800,
          up noticeably (50 to 54) and interest goes up a lot (20 to 31)")   ┘ scroll ~250 tokens
```

- **The system prompt is a constant**: no names, rounds or company in it, so it's byte-identical for every call. The company's name goes in the scene.
- **The one cache breakpoint sits on the system prompt.** It covers the tools too, since tools render first.
- **`tool_choice` names the scene's tool** (`talk`, `post` or `scroll`). Changing `tool_choice` per call doesn't invalidate the cached tools and system prompt. A forced tool also means the model doesn't think first, which is what we want.
- **Thinking is off and effort is `low`.** The `thought` field is the visible reasoning, and it comes first in each schema, so the model gives its reason before the words.
- **After a quiet spell (over 4 minutes), the first call goes alone** and the rest wait for it. A cache entry can be read only once the call that wrote it has answered, so this avoids paying for a cache write on every call of the first wave.
- **What the model must not do:** change or state any number, contradict the decided effects, name real companies, products or people, or assume anyone's gender.

## Tools

```jsonc
// strict: true, additionalProperties: false; the same three tools on every call
talk   { "thought": "≤15 words", "words": "≤30 words", "listener_thought": "≤15 words" }
post   { "thought": "≤15 words", "words": "≤40 words", "reader_thoughts": ["≤15 words", …] }   // one per reader, in order
scroll { "reader_thought": "≤15 words" }
```

Go checks every answer:
- It trims each field and cuts anything too long.
- Anything blank or missing, such as a reader the model skipped, gets the stub's line.
- A failed call, a refusal (`stop_reason: "refusal"`), a call past a cap or a cancelled request gets the stub's lines for that event, and those are not cached.

## Caching and replays

- **In memory, by prompt.** The key is `sha256(prompt version ‖ model ‖ tool ‖ scene text)`, and the cache holds up to 100,000 answers.
  - The sim is deterministic and the scene text includes the words the teller heard, so a replay of the same rounds builds the same prompts and gets the same answers.
  - Measured against a fake API: asking for rounds 1–20 after rounds 1–10 made 439 new calls and answered 357 from memory.
- **Bump `promptVersion`** in `internal/provider/prompt.go` whenever the system prompt, the tools or the scene text change.
- **The cache is lost on restart.** A restarted server pays again for the rounds it re-narrates. Saving answers to disk is a next step.

## Spend caps

CLAUDE.md hard rule 4 caps rounds and blobs per run. The voice adds its own caps:

| Setting | Default | On hit |
|---|---|---|
| `VOICE_MAX_CALLS` | 2,500 model calls per `/api/run` (a full run needs ~2,000) | The rest of the run uses the stub voice |
| `VOICE_MAX_USD` | $5.00, estimated from `usage` for the server's lifetime | Every later call uses the stub voice, and the log says so |
| `VOICE_IN_FLIGHT` | 16 requests at once | Calls queue |
| `VOICE_TIMEOUT_SECONDS` | 30 per call, retries included | That event uses the stub |
| `max_tokens` | 1,024 per call | A cut-off answer uses the stub |

The SDK retries 429, 5xx and connection errors twice. Each `/api/run` logs one line with its calls, answers from memory, fallbacks, tokens and estimated cost.

## Turning it on

In `.env` (server only; the browser never sees the key):

```
BRAIN=anthropic
ANTHROPIC_API_KEY=sk-ant-...
MODEL=claude-haiku-5-5
```

Then run `make dev`. The server logs `blobs speak with the anthropic voice (…)` at start and a `voice:` line per run. If `BRAIN=anthropic` is set without a key, the server refuses to start rather than silently using the stub. If the API rejects the key (401 or 403), the server logs it once and uses the stub voice until it restarts.

# Cost and time

Claude Haiku 5.5, for prompts up to 100K tokens: $0.10 per million input tokens and $0.50 per million output tokens. Cache reads cost $0.01 per million and 5-minute cache writes $0.125 per million.

Per full run, seed 1 with the first option of every story: 1,972 calls *(measured)*, with tokens *(estimate)*:

| Part | Tokens | Cost |
|---|---:|---:|
| Cached prefix, read on every call (~1,850 tokens each) | 3.65M | $0.04 |
| Scenes, uncached | 0.81M | $0.08 |
| Output (talk ~90, post ~220, scroll ~30) | 0.23M | $0.11 |
| **Total** | | **≈ $0.23** |

- **Without caching** it would be about $0.56. A run with bolder choices has more posts, so allow up to about $0.50.
- **Time:** about 2,000 calls at ~1.5 s each, 16 at a time, is about 3 minutes for a full run, and about 40 s for each 10-round chunk the client asks for *(estimate)*. `VOICE_IN_FLIGHT=32` halves that. The longest chain (18 calls) never binds.
- **Rate limits:** 16 in flight is about 650 requests per minute, about 270K uncached input tokens per minute and about 75K output tokens per minute. That's well inside Anthropic's Start tier (4,000 requests, 2M input tokens and 400K output tokens per minute). Cache reads don't count towards the input limit.
- **The wait is the weak spot.** The client fetches the whole run before playing, so with a model the first play takes minutes. Streaming rounds is the first next step.

# Options considered

| Option | Pros | Cons |
|---|---|---|
| **Voice after the run (built)** | The sim is untouched and deterministic. Text can't break balance. One cheap call per event. Replays are free. | Thoughts explain decisions rather than make them. The run's words wait for its numbers. |
| Every blob decides every round, all 100 at once | The most "alive". Blobs choose whether to act and whom to tell. | Not a traditional sim any more. Runs aren't reproducible, the whole round loop must change, about 5,000 calls per run, and LLM agents lean towards the truth, which fights the hype mechanic. |
| The model nudges numbers within bounds | Personas change outcomes a little | Needs calibration and a MODEL.md rewrite, and breaks determinism unless every answer is saved |
| Many blobs in one call | Few requests | Personas blur into one voice, one bad answer loses many events, and it's barely cheaper with caching |
| Message Batches (half price) | Cheapest per token | Results take up to an hour. Fine for pre-writing fixed towns, not for live play. |
| Local model (llama.cpp / Ollama) | Free and offline | Hours per run on a laptop, and weaker at strict tool calls |

# Risks

- **Text that contradicts the numbers.** The scene gives the decided effect in words and numbers, and the system prompt makes this the first rule. Spot-check thoughts against `dp`/`di` once a key is in use.
- **Real names leak.** The system prompt forbids real companies, products and people. There is no denylist check yet; add one before anything is public.
- **Bland retellings.** LLM retellings drift towards calmer versions. The claim strength in each scene, "makes it sound like a big deal", pushes the words to match the sim's drift.
- **Personas blur.** Traits, shape culture and age voice are in every scene. If the voices still sound alike, add seeded quirks to the persona line.
- **Refusals.** Haiku 5.5 can decline, with no server-side fallback. Treat it as a failed call: that event gets the stub's lines.
- **Spend.** Covered by [#spend-caps](#spend-caps). The estimates assume the published prices; an unknown `MODEL` is costed at Opus rates so the cap errs on the safe side.

# Next steps

1. **Stream rounds to the client** so play starts with the first round, not after the whole run.
2. **Save answers to disk** under `RUNS_DIR`, so a restart doesn't pay again and a finished run can be re-narrated for free.
3. **Speech and thought bubbles** over the blobs in the 3D scene, from the same `w`, `t` and `r`.
4. **Measure with a key:** the real cost per run, the cache hit rate, the seconds per chunk, and a read-through of a few hundred thoughts.
5. **A denylist check** for real names before public use.

# Sources

- Claude API docs: pricing, prompt caching, strict tool use, rate limits, Claude Haiku 5.5 notes. platform.claude.com/docs.
- Anthropic Go SDK: github.com/anthropics/anthropic-sdk-go (v2).
- Telephone-game attractors in LLM retellings: https://arxiv.org/abs/2407.04503
- LLM agents drift towards the truth in opinion dynamics: https://arxiv.org/abs/2311.09618
- Persona collapse: https://arxiv.org/abs/2402.01908

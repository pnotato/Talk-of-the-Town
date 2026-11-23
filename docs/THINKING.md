# Thinking

How to give each of the 100 blobs an LLM brain with a persona, at the lowest cost that still lets them reason a little and call tools.

Status: **proposal, nothing implemented.** Researched 2026-11-22. Revised 2026-11-23 to follow [agent-economy](https://github.com/leakyhose/agent-economy)'s design. Prices change often, so re-check them before you budget.
Numbers marked *(measured)* come from running the current Go sim. Numbers marked *(estimate)* are token guesses to replace with real `usage` logs once a provider exists.

# Summary

- **Do what agent-economy does.** Every round, every blob gets one model call, and all 100 go out at once. Each blob sees its own situation, picks what to do with tool calls, and gives a one-line reason. The round moves on when 90% have answered or 8 s have passed. Anyone late gets the stub's decision.
- **The setup:**
  1. **One cached prefix shared by all 100 blobs:** the tool list plus a system prompt with the town's rules, the shape cultures, the trait glossary and examples. It never changes during a run.
  2. **The persona goes in the per-blob message, not the system prompt.** That keeps the prefix identical for everyone. Each message is a persona card, the story as the blob heard it, what reached it since its last turn, who is around today, and 6 lines of memory.
  3. **Memory is written by the sim**, not by the model.
  4. **Tools are the actions:** `react`, `talk`, `post`, `scroll`, `stay_in`. Each one requires a `reason`. Thinking is off.
  5. **The rules stay in Go.** The model chooses actions and picks from fixed choices (how hard to spin, how much to believe). Go's formula works out what each choice does to the scores. agent-economy does the same: the model picks a job and an order, and the code runs the economy.
- **Cost: about $1.20 per 50-round run** on Claude Haiku 5.5 with caching *(estimate)*, or ~$2.90 without caching. That's about 3× the cheapest setup in the earlier draft (~$0.40), but still about a dollar.
- **Three changes make it work:**
  1. **Live games.** The server keeps the game in memory between the player's choices. Today it re-simulates from round 0 for each choice.
  2. **Decide-then-apply rounds.** All blobs decide from the round's starting state, then the results are applied. News moves at most one hop per round.
  3. **Only the stub is deterministic.** A live run is saved when it ends and replayed from that file, as agent-economy does.
- **Time:** a round takes about 3–6 s, so a run takes about 5 minutes. Rounds stream to the client, so the player watches round `r` while round `r+1` computes.

# How agent-economy does it

Read at commit d98115a: `backend/src/brains/chat.mjs`, `brains/prompt.mjs`, `brains/providers.mjs`, `tools.mjs`, `world.mjs`.

- **One fresh call per villager per round, all 100 at once.**
  - Each decision is a new two-message conversation: the system prompt plus "here's your situation". Nothing carries over between rounds except what the game writes into the situation.
  - There is no global concurrency limit, only an optional limit per model.
  - The round closes when 90% have answered (`DECIDE_QUORUM`) or 8 s pass (`DECIDE_TIMEOUT_MS`). Late villagers keep last round's job and post no orders. A round takes about 6.4 s.
- **One shared, cached prefix.**
  - The system prompt holds the economy's rules, with every number filled in from config. It's rebuilt only when a setting changes, so it stays byte-identical.
  - The system prompt plus the tool definitions are 78% of every request.
  - On Anthropic they call the Messages API directly, because the OpenAI-compatible endpoint has no prompt caching. One `cache_control` marker on the system prompt covers both the tools and the system prompt.
- **The persona goes in the situation message.** It opens with `"You are {name}. This is round N."`, then one of four temperament sentences picked from a seeded risk trait (*"By nature you are careful: you keep a good reserve…"*). The code calls this "a nudge, not a rule". Skill differences show as numbers ("a shift of fishing is worth ≈12 coins to you").
- **Memory is the last 6 lines the game logged for that villager** ("The bank refused your loan…"), shown under "Recently:".
- **10 action tools, each requiring a `reason`** ("Why, in one short sentence, in your own voice"). That reason is the villager's visible thought.
  - The game enforces every rule. An invalid action gets a refusal message as the tool result, and the villager tries again, up to 3 tries per decision.
  - A decision ends once a job is chosen and nothing was refused.
- **Thinking is off.** They measured Haiku at effort `low`: 3.9 s instead of 2.0 s per decision, ~30% more cost, and no better results.
- **On 429 or 529,** they wait as long as `retry-after` asks, capped at 2.4 s, plus jitter. A retry doesn't use up one of the villager's tries.
- **Cost:** $1.33 for 3,059 calls on `gpt-5.6-luna` (30 villagers, 6 minutes).
- **Runs aren't reproducible.** Each run is live, and the log is saved to `runs/`.

# Why we can do the same

The earlier draft said to call the model only for each talk, post and hearing. Here is why, and why none of those reasons rules out agent-economy's approach:

| Earlier objection | What agent-economy does | What we do |
|---|---|---|
| `POST /api/run` re-simulates from round 0 for every choice, so earlier rounds would be paid for again | Keeps the village in server memory while it runs | Keep the game in memory between choices ([#live-games](#live-games)). Nothing is re-simulated. |
| Haiku 5.5 rejects `temperature`, so the same run can't be reproduced | Doesn't need to reproduce runs. It saves them. | Only the stub needs to be deterministic (CLAUDE.md hard rule 2: dev, tests and CI). A live run is saved and replayed from its file. |
| ~5,000 calls instead of ~2,000 | ~100 calls per round | ~$1.20 per run instead of ~$0.40. Still about a dollar. |
| 100 calls at once hits rate limits | 100 at once, with a quorum, a timeout and `retry-after` | The same, with rounds paced to playback speed so a game stays inside Anthropic's Start tier ([#rate-limits-and-latency](#rate-limits-and-latency)) |
| LLMs lean towards the truth whatever their persona, which would weaken the hype mechanic | Their economy has no hype mechanic. All rules are still in code. | The same split: the model picks actions and bounded reactions, and Go computes the scores ([#what-the-model-decides](#what-the-model-decides)) |

The one real cost is the round order: all blobs decide at once, so news can't hop twice in a round, and a listener reacts in its next turn. agent-economy's round works the same way.

# The design

## One round

```
if r % 10 == 0: announce(story)            // the company's words go into some inboxes
if r % 10 == 8: ship(story)                // MODEL.md#shipping, unchanged
move every blob (unchanged)
observe: build 100 situations from the round's starting state
decide:  100 calls at once; close at 90% answered or 8 s; late blobs get the stub's decision
apply, in id order:
    each blob's reactions to its inbox         → perception, interest, heard (MODEL.md#influence)
    each blob's activity                       → fills next round's inboxes
        talk:   the partner's inbox
        post:   8 readers drawn by Go (MODEL.md#social-media)
        scroll: one post from the feed, drawn by Go (MODEL.md#scrolling)
decay; record
```

- **What changes:**
  - A hearing lands in the listener's inbox and takes effect when the listener reacts, in its next turn.
  - News moves at most one hop per round. Today a blob told something early in a round can retell it later the same round ([MODEL.md#round-order](./MODEL.md#round-order)).
  - The stub brain follows the same order, so the golden runs change once.
- **Announce and ship come before the observe step,** so blobs react to them in the same round.
- **The sim stays I/O-free.**
  - The `Brain` interface becomes batch-shaped: `Decide(ctx, []Situation) []Decision`.
  - `internal/provider` makes the calls. `internal/sim` builds the situations and applies the decisions.
  - The stub implements `Decide` with today's formula draws.

## What a blob sees

```
tools     react, talk, post, scroll, stay_in   (fixed, strict)                ┐ cached once,
system    the town, and Outrage AI Company (fictional)                        │ shared by all
          how a day works; what each tool and each choice does               │ 100 blobs and
          the six shape cultures; the trait glossary; voice guide by age      │ every round
          10–20 short examples                                                │ (~3–4K tokens)
          ── cache_control: ephemeral (5 min) ──                              ┘
user      "You are Bob Pickle, 20, a Triangle. Round 12."                     ┐ not cached
          one temperament line per trait; a seeded quirk                      │ (~700–1,000 tokens)
          the story as you heard it, and who told you                         │
          since your last turn: [1] Ada told you "…"  [2] a post by Kim: "…"  │
          around today: Ada Plum (your sister), Sam Rook (neighbour, Square)  │
          today you can: talk, post, scroll, stay in                          │
          recently: the last 6 memory lines                                   ┘
```

- **One cache breakpoint, at the end of the system prompt.** Everything above it is byte-identical for every blob and every round: no round number, name or timestamp. Tools render first, so the tool list never varies per blob. Build the system prompt once and reuse the same string. agent-economy memoises theirs.
- **Put shared text in the prefix and refer to it by name in the message.** The persona says "Triangle", and the cached system prompt explains what Triangles are like.
- **The story goes in the message, not behind a second breakpoint.** It changes every 10 rounds and is ~150 tokens.
- **Pre-warm once per game** with a `max_tokens: 0` request. A cache entry is readable only after the first response starts streaming, so a cold start of 100 parallel calls would pay for 100 writes. If the player pauses for more than 5 minutes between stories, the next round pays one cold write (~$0.0004).
- **"Around today"** is 3–4 blobs drawn by Go with the partner weights in [MODEL.md#partner-choice](./MODEL.md#partner-choice) (home, neighbourhood, shape). Who you run into stays in Go. Whether to talk, and to which of them, is the blob's choice. Recluses get nobody.
- **Inbox size:** today's sim produces ~6,500 hearings per run *(measured)*, so an inbox averages about 1.3 items. Show at most 5, newest first.
- **Check `usage.cache_read_input_tokens > 0` in an integration test.** A cache that silently stops working costs money without any error.

## Personas

- **Build the persona card in Go** from the blob's own fields: name, age, shape, tags, family/leader/recluse, home and neighbourhood. No model call is needed.
- **Add one temperament line per trait**, as agent-economy does with risk. For example:
  - `gullible`: *"You tend to believe what people tell you, especially people you trust."*
  - `skeptic`: *"You don't believe a claim until you see it."*
  - `quiet`: *"You rarely bring up news."*
  - `chatty`: *"You love passing news on, the juicier the better."*
- **For more variety at no cost,** add a seeded quirk from a fixed, reviewed list (e.g. "talks about their garden") and a speech style by age group.
- **Optional richer backstories:** generate a library once (~100 × 300 output tokens ≈ $0.02) and check it into `internal/sim/content/`. Don't generate them per run.

## Tools

```jsonc
// all strict: true, additionalProperties: false; the same list for every blob
react   { "reason": "≤15 words", "item": 1, "reaction": "dismiss|doubt|unsure|believe|convinced" }
talk    { "reason": "≤15 words", "to": "Ada Plum", "spin": "downplay|faithful|embellish|exaggerate", "words": "≤30 words" }
post    { "reason": "≤15 words", "spin": "downplay|faithful|embellish|exaggerate", "words": "≤40 words" }
scroll  { "reason": "≤15 words" }
stay_in { "reason": "≤15 words" }
```

- **One reply can hold several `react` calls and exactly one activity** (`talk`, `post`, `scroll` or `stay_in`). An inbox item with no `react` counts as `unsure`, which is the stub formula.
- **The `reason` comes first** in each schema, so the blob says why before it picks. That gives a cheap visible thought for the UI. It's agent-economy's `reason` field.
- **Go enforces the rules** and answers a broken one with a refusal as the tool result. Then the blob gets another turn, up to 3 in all. Examples:
  - "Ada isn't around today."
  - "You haven't heard any news to pass on."
  - "You're 11; you don't post."
  - "You're a recluse; you don't talk in person."
- **A decision ends once an activity is chosen and nothing was refused.** As in agent-economy, a 429 doesn't use up one of the turns.
- **Don't force `tool_choice`.** Haiku 5.5 skips thinking when it's forced, and plain `auto` with "call your tools" works. agent-economy doesn't force it either.
- **No lookup tools** like `recall(topic)`. Each round trip re-sends the prompt. Put memory in the message instead.

## What the model decides

| Option | Model output | Verdict |
|---|---|---|
| A1. Flavour only (the current `Brain` contract) | Text. The numbers come from the formula. | Safe, but the blobs' choices change nothing |
| **A2. Actions + bounded choices (recommended)** | Whether to act, whom to tell, how hard to spin it, how much to believe it, plus words and a reason | agent-economy's split. Needs a calibration pass. MODEL.md#drift must change, because it currently says the model may not change the number. |
| A3. Full control | New perception and interest numbers directly | LLMs give poorly calibrated numbers and lean towards the truth ([#risks](#risks)). Balance becomes untestable. |

What the A2 choices do in Go *(design; numbers to calibrate)*:

| Choice | Effect |
|---|---|
| Activity | `talk` / `post` / `scroll` / `stay_in`, chosen by the model instead of the `pActive` draw in [MODEL.md#actions](./MODEL.md#actions) |
| `to` | Picks the partner from today's 3–4 candidates, who were drawn with the partner weights |
| `spin` | `downplay` −4, `faithful` 0, `embellish` +3, `exaggerate` +6, **added on top of** `sharpen` (+3 talk / +5 post) in [MODEL.md#drift](./MODEL.md#drift). Clamped to 0–100. |
| `reaction` | `dismiss` ×0.6, `doubt` ×0.8, `unsure` ×1.0, `believe` ×1.2, `convinced` ×1.4 on `k` in [MODEL.md#influence](./MODEL.md#influence). `alpha` is still capped at 0.50. |

Trust, persuasiveness, channel, repeat, credibility and shipping all stay in Go. `sharpen` keeps pushing claims up by default, and the model's choices move results by about ±40% around that. The persona still names the blob's credulity so its words and reasons match. The small double count is deliberate and is tuned in calibration.

## Memory

agent-economy's rule: the sim writes memory and the model never does. Render it as ≤ 250 tokens:

- **The last 6 things that happened to the blob,** one line each, e.g. "Round 11: you told Ada it 'replaces your doctor'. She believed you."
- **One line per past story,** what it heard versus what shipped, e.g. "Wick Health: heard 'replaces your doctor', got a notepad."

The inbox carries the actual words each speaker used. So the telephone game shows up as text the player can read, not only as a number.

When a story ships, the ship goes into that round's situation ("It shipped today: … You'd heard: '…'") and into memory. [MODEL.md#shipping](./MODEL.md#shipping) still sets the scores. The blob's next words and reasons show how it feels about it, so no separate reflection call is needed.

## Thinking

- **Thinking is off by default** (`thinking: {type: "disabled"}`). The `reason` field does the "somewhat think" job. agent-economy measured thinking as slower and costlier with no gain.
- **Optional:** adaptive thinking at effort `low` for the 6 leaders only, a few cents per run. Measure before turning it on for everyone. For all 100 blobs it adds ~$0.50 per run and roughly doubles the round time.
- **Thinking tokens count against `max_tokens`.** Use about 600 with thinking off and about 2,000 with it on.

## Live games

agent-economy keeps the world in memory while it runs. We do the same:

- `POST /api/games {seed, choice}` starts a game. It streams rounds 0–9 as NDJSON, then waits for the next choice.
- `POST /api/games/{id}/choices {choice}` streams the next 10 rounds.
- The server holds each `*sim.Game` in memory, keyed by id. A game expires after 15 idle minutes.
- After round 49 the server writes the RunLog with `WriteRun`, plus a call log (`<run>.calls.jsonl`: each situation, reply, usage, latency, and whether the stub stepped in). That log is for debugging prompts and checking cost.
- A saved run replays from its file and costs nothing.
- The sim API becomes steppable: `sim.NewGame(seed)`, `(*Game).Announce(optionID)`, `(*Game).Round(ctx, brain)`. `sim.Run` stays as a loop over those with the stub, so `POST /api/run` and the golden tests keep working.
- The client sends back only the player's choices (CLAUDE.md hard rule 3). With the stub brain, the same endpoints return instantly.

## Spend caps

This extends CLAUDE.md hard rule 4. The server refuses or degrades a game past any of these limits:

| Cap | Suggested | On hit |
|---|---|---|
| `MAX_LIVE_GAMES` | 1 on the Start tier | A new game is refused |
| `MAX_CALLS_PER_RUN` | 7,500 (5,000 + follow-up turns) | Remaining decisions use the stub |
| `MAX_USD_PER_RUN` (from `usage`, including cache tokens) | $3.00 | Same |
| `max_tokens` per call | 600 (thinking off) | That blob gets the stub's decision |
| Turns per decision | 3 | Same |
| Round deadline | 90% answered or 8 s | Late blobs get the stub's decision |

Retry 429 and 529 the way agent-economy does: wait for `retry-after`, capped at 2.4 s, plus jitter. Log tokens per call so each run reports its cost.

## Rate limits and latency

- **Per round:** 100 calls, plus ~10% follow-up turns. agent-economy measured a median of ~2.3 s per call. With the 90% quorum, a round takes about 3–4 s, and 8 s at worst.
- **Pace rounds to playback, about 6 s each.** A round's animation already lasts several seconds, so this costs the player nothing. It also keeps one game inside Anthropic's **Start tier** (4,000 requests/min, 2M input tokens/min, 400K output tokens/min). Cache reads don't count towards the input limit.

  | Round length | Requests/min | Uncached input tokens/min | Output tokens/min |
  |---|---:|---:|---:|
  | 6 s (paced) | ~1,100 | ~1.0M | ~190K |
  | 3 s (as fast as possible) | ~2,200 | ~2.0M (at the limit) | ~380K |

- **One live game per key on the Start tier.** Each concurrent game adds the same load, so `MAX_LIVE_GAMES` grows with the tier.
- **New organisations may start on a lower "Evaluation" tier,** and sudden bursts can hit separate ramp-up limits. When that happens, rounds slow down rather than fail, thanks to the `retry-after` backoff. agent-economy hit 429s at ~1,000 calls/min on OpenAI.
- **A run takes about 5 minutes** at the paced speed, about 1 minute per 10-round chapter. Rounds stream, so the player is never left on an empty screen.
- **Strict tools add latency the first time a new schema is used.** Compiled schemas are cached for 24 hours, and the pre-warm absorbs that cost.

# What a run costs

Claude Haiku 5.5, for prompts of 100K tokens or less:
- $0.10 per million input tokens and $0.50 per million output tokens
- cache reads cost 0.1× input ($0.01); 5-minute cache writes cost 1.25×
- the minimum cacheable prefix is 512 tokens
- thinking tokens bill as output

One call: 3,500-token cached prefix + 900-token per-blob message + 180 output tokens (one activity, 1–2 reactions, reasons) *(estimate)*:

| Part | Tokens | Cached | Uncached |
|---|---:|---:|---:|
| Shared prefix (tools + system) | 3,500 | $0.000035 | $0.000350 |
| Per-blob message | 900 | $0.000090 | $0.000090 |
| Output | 180 | $0.000090 | $0.000090 |
| **Total** | | **$0.000215** | **$0.000530** |

Per run: 100 blobs × 50 rounds = 5,000 calls, plus ~10% follow-up turns *(estimate)*:

| Variant | Per run |
|---|---:|
| **Cached, thinking off (recommended)** | **$1.18** |
| Cached, light thinking (~200 tokens per call) | $1.68 |
| No caching | $2.91 |
| Cached, skipping blobs with nothing heard and nobody around (~40% fewer calls) | ~$0.71 |
| Claude Sonnet 5.5 instead, cached | $21.62 |

What follows from this:

1. **Caching halves the bill.** After that, output and the per-blob message cost about the same. Keep outputs short: enums, ≤30 words of speech, a ≤15-word reason.
2. **Putting more into the cached prefix is almost free.** 1,000 extra cached tokens cost $0.05 per run.
3. **The Batch API doesn't apply,** because a live game can't wait up to an hour for results.

# Alternatives

| Option | Per run | Pros | Cons |
|---|---:|---|---|
| **Every blob, every round (recommended)** | ~$1.20 | Real agents: they choose whether to act, whom to tell, how to put it and what to believe. Same loop as agent-economy, which runs it at 100 agents. Simple to explain and debug. | ~3× the per-event setup. One-round lag on reactions. The activity rate needs calibrating. |
| Skip idle blobs | ~$0.70 | ~40% cheaper | Blobs with nothing new and nobody around don't get to choose. An extra rule to maintain. |
| Per event (the earlier draft) | ~$0.40–0.80 | Cheapest live option | The sim still decides who acts and when. The model only shapes events the sim already chose. |
| Many blobs in one call | about the same | Few requests, which suits a low rate-limit tier | Personas blur into one voice: one study found single-call play matched human behaviour 50% of the time against 87.5% for separate agents. One bad output loses many blobs. |
| Precomputed towns | ~$110 per town once, then $0 | No wait, and every line can be reviewed | Only fixed towns. Needs a deterministic tape for every branch (471 ten-round chunks per seed). Doesn't fit live agents. |
| Local model (llama.cpp / Ollama / MLX) | $0 | Free and offline, good for prompt iteration | Roughly 2–3 hours per run on an M4 Pro *(estimate)*. Small models are weaker at tool calls and at holding a persona. |

# Risks

- **Everyone becomes chatty.**
  - Today `pActive` keeps quiet blobs quiet (0.10–0.90; [MODEL.md#actions](./MODEL.md#actions)). Left to choose, LLM personas tend to collapse into a few response types, so every blob may talk every round and news would spread far faster than designed.
  - Mitigation: temperament lines and examples for quiet blobs, and a calibration check on the activity rate per socialness tag.
  - Fallback: Go draws `pActive` again, and an unlucky blob is told "you're busy today", which leaves it only `scroll` and `stay_in`. See [#open-decisions](#open-decisions).
- **LLMs lean towards truth and consensus.** Agents tend to drift to the accurate view even when told to be gullible, which would weaken the core hype mechanic. Mitigation:
  - Go keeps the scores (A2).
  - The persona says plainly that this is a fictional game and that gullible people believe their friends.
  - The examples cover every reaction level.
  - Calibration checks the reaction mix per credulity tag.
- **Retold stories go bland.** Along a chain, LLM retellings drift towards calmer "attractors", the opposite of hype. Mitigation: `sharpen` stays in Go, and `spin` is an offset on top of it. Watch the spin mix per trait.
- **Herding.** LLM agents conform to peer pressure more than people do. Mitigation: Go owns the update rule, and a blob sees only its own inbox, never a town-wide tally.
- **Runs can't be reproduced.** A bug seen in a live run may not happen again. Mitigation: the call log records every situation and reply, and the stub path stays deterministic for tests.
- **Real names leak.** Mitigation: an instruction in the system prompt plus a Go denylist check. On a hit, drop the text and keep the numbers.
- **Refusals.** Haiku 5.5 can decline a request (`stop_reason: "refusal"`), with no server-side fallback. Treat it like a timeout: that blob gets the stub's decision.
- **Runaway spend.** Covered by [#spend-caps](#spend-caps).

# Provider comparison

For this workload: 5,000 calls × (3,500 cached + 900 uncached input + 180 output), plus 10% follow-up turns. Prices are USD per million tokens, checked on official pricing pages on 2026-11-22.

| Option | In / Out | Cached read | No cache | Cached |
|---|---|---|---:|---:|
| **Claude Haiku 5.5** | 0.10 / 0.50 | 0.01 | $2.91 | **$1.18** |
| Claude Sonnet 5.5 | 2.00 / 10.00 | 0.10 | $58.20 | $21.62 |
| OpenAI gpt-6-luna | 0.10 / 0.50 | 0.01 | $2.91 | $1.18 |
| OpenAI gpt-5-nano (deprecated) | 0.05 / 0.40 | 0.005 | $1.60 | $0.73 |
| Gemini 2.5 Flash-Lite | 0.10 / 0.40 | 0.01 | $2.81 | $1.08 |
| Gemini 3.5 Flash-Lite | 0.30 / 2.50 | 0.03 | $9.68 | $4.48 |
| DeepSeek flash (off-peak) | 0.15 / 0.60 | 0.003 | $4.22 | $1.39 |
| Groq gpt-oss-20b | 0.075 / 0.30 | 0.0375 | $2.11 | $1.39 |
| Fireworks gpt-oss-120b | 0.15 / 0.60 | 0.015 | $4.22 | $1.62 |
| Local Mac (llama.cpp / Ollama) | $0 | n/a | $0 | $0 |

What this means:

- **Among hosted options, the provider changes the bill by cents.** So choose on tool-call quality, latency and Go support.
  - Haiku 5.5 is the project default (CLAUDE.md hard rule 2).
  - It has `strict` tools and an official Go SDK (`anthropic-sdk-go`).
  - Its 512-token cache minimum is the lowest here.
  - agent-economy ships an Anthropic provider for it too.
- **Caching minimums differ.** OpenAI's is 1,024 tokens. Gemini 3.x and 4 have an implicit minimum of 4,096, so a 3,500-token prefix wouldn't cache there without padding.
- **Thinking can cost a lot.** 200 thinking tokens per call is +$0.50 per run on Haiku. The same goes for `reasoning_effort` on OpenAI and DeepSeek's thinking mode.
- **Local models are too slow to play with.**
  - The best small tool-callers are Qwen3 8B and 14B, with a tool-selection F1 of 0.92–0.97, against 0.79–0.84 for Llama 3.1 8B.
  - A 7B Q4 model generates about 50 tokens/s on an M4 Pro and ~120 on an M5 Max.
  - 5,000 calls per run means hours, not minutes. That's fine for offline prompt iteration as a `BRAIN=local` provider, but not for live play.

# Prior art

| System | Scale | What made it cheap (or expensive) | Lesson for us |
|---|---|---|---|
| **agent-economy** | 100 agents, 6.4 s per round | One stateless call per agent per round, all in parallel. Cached shared prefix (78% of each request). Persona in the situation message. 6 lines of memory written by the game. Tools with a `reason`. Thinking off. 90% quorum. $1.33 for 3,059 calls. | **The design we follow.** |
| Generative Agents / Smallville (Park 2023) | 25 agents, 2 game days | "Thousands of dollars" and days of runtime: free-text calls at every step (observe, retrieve, reflect, plan hourly, turn-by-turn dialogue) | One call per agent per round, not one per step |
| Affordable Generative Agents (Yu 2024) | 25 agents | Reused plans the model had already written, and kept short memories (~100 tokens instead of ~2,000). Used 31–43% of the baseline tokens. | Short memory written by the sim |
| Lyfe Agents (2023) | Small town | The model picks a high-level option and cheap checks decide when it ends. About $0.50 per agent-hour. | The model decides. Code carries it out. |
| LLM Archetypes / AgentTorch (Chopra 2025) | 8.4M agents | One query per archetype group. ~400 queries in all. | A fallback for much larger towns, not needed at 100 |
| AgentSociety (2025) | 10k+ agents | Formulas for mobility and the economy, "to reduce LLM overhead" | Formula sim plus model calls is the standard pattern |
| OASIS (CAMEL-AI 2024) | Up to 1M agents | A local Llama-3-8B on vLLM. Most agents idle each step. | Agents herd more than humans do |
| TinyTroupe (Microsoft 2025) | n/a | Caches every model input→output pair | The call log, if we ever want exact replays |
| Chuang et al. (NAACL Findings 2024) | Opinion dynamics | Agents drift to the factual answer whatever their persona | Go owns the scores (A2) |

# Phased plan

1. **Steppable sim, no API.**
   - `sim.NewGame`, `Announce` and `Round`.
   - The batch-shaped `Brain` (`Decide`) and the observe → decide → apply round.
   - The stub implements the same tools.
   - New golden runs. Cost $0.
2. **Live games in the server.**
   - The `/api/games` endpoints, NDJSON streaming and in-memory games.
   - The RunLog is saved at the end.
   - The UI moves to the new endpoints. With the stub they return instantly.
3. **Haiku 5.5 provider.**
   - The cached prefix, the pre-warm, the parallel round with its quorum and deadline, retries, the caps and the call log.
   - Measure $/run, cache hit rate and seconds per round on 3 seeds.
4. **Calibrate** against the [MODEL.md sanity table](./MODEL.md#sanity-check).
   - Measure the activity rate per socialness tag, the reaction mix per credulity tag and the spin mix.
   - Tune the temperament lines, the examples and the multipliers.
5. **UI.** Speech and thought bubbles from `words` and `reason`, if wanted.

# Open decisions

1. **What the model decides.** Recommended: actions plus bounded nudges (A2), with the scores computed in Go. The alternative is to let the model set the numbers itself (A3).
2. **Who decides whether a blob acts.** Recommended: the model, as in agent-economy, with a calibration check on activity rates. The alternative is that Go keeps `pActive` and the model only decides how to act.
3. **Round order.** Is it OK that reactions land a round later and news moves at most one hop per round?
4. **Rate-limit tier.** Which tier will the API key be on? That sets `MAX_LIVE_GAMES`.
5. **UI.** Should blobs' words and reasons show up as speech and thought bubbles, or stay in the log only?

# Sources

- agent-economy: https://github.com/leakyhose/agent-economy (commit d98115a). Files: `backend/src/brains/chat.mjs`, `brains/prompt.mjs`, `brains/providers.mjs`, `tools.mjs`, `world.mjs`, `config.mjs` (`DECIDE_QUORUM`, `DECIDE_TIMEOUT_MS`), and the README's "Numbers worth knowing".
- Claude API docs: prompt caching, pricing, rate limits, strict tool use, Claude Haiku 5.5 notes. platform.claude.com/docs (pricing, build-with-claude/prompt-caching, api/rate-limits, build-with-claude/structured-outputs).
- Other providers, fetched 2026-11-22: aistudio.google.com/docs/pricing and /docs/caching; developers.openai.com/api/docs/pricing and /guides/prompt-caching; api-docs.deepseek.com/quick_start/pricing; console.groq.com/docs/models; fireworks.ai/pricing.
- Local inference: github.com/ggml-org/llama.cpp (server README; Apple Silicon benchmarks, discussion 4167); docker.com/blog/local-llm-tool-calling-a-practical-evaluation.
- Generative Agents: https://arxiv.org/abs/2304.03442
- Affordable Generative Agents: https://arxiv.org/abs/2402.02053
- Lyfe Agents: https://arxiv.org/abs/2310.02172
- LLM Archetypes / AgentTorch: https://arxiv.org/abs/2409.10568
- AgentSociety: https://arxiv.org/abs/2502.08691
- OASIS: https://arxiv.org/abs/2411.11581
- TinyTroupe: https://arxiv.org/abs/2507.09788
- Chuang et al., opinion dynamics with LLM agents: https://arxiv.org/abs/2311.09618
- Telephone-game attractors: https://arxiv.org/abs/2407.04503
- Conformity in LLM agents: https://arxiv.org/abs/2405.03862
- Persona collapse: https://arxiv.org/abs/2604.24698 (2026 preprint), https://arxiv.org/abs/2402.01908
- Single call vs separate agents: https://arxiv.org/abs/2402.08189
- Small-model tool calling (When2Call): https://arxiv.org/abs/2504.18851

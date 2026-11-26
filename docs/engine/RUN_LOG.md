# The run log

A **RunLog** is one run of the game as a single JSON document: the starting
town, the walk map, and round by round where every blob walked, who talked
to whom, and every score. `POST /api/run` returns it, and the client replays
it. The Go structs in `internal/sim` (`RunLog` in `round.go`, `WalkMap` in
`walk.go`) are the source of truth. The TypeScript types in
`web/src/generated/types.ts` are generated from them with `make types`.

Everything in a run log is SIMULATED: the company (Outrage AI Company), its
announcements and every blob are fictional. `label` is always `"SIMULATED"`,
and the UI must show it.

## When and where logs are written

The server writes a log file only when `RUNS_DIR` is set. `make dev` and
`make server` set it to `runs/scratch` (git-ignored). `.env` or your shell can
override it, and an empty value turns writing off.

- **At startup**, before it listens, the server plays seed 1 with the first
  option of every moment and writes that run. It always uses the stub brain,
  so a restart never costs anything.
- **After each finished run**, meaning a `POST /api/run` with all 5 choices,
  so `next` is `null`. The file holds exactly the bytes sent to the client.
  Partial runs (fewer than 5 choices) are not written.

File names are `seed-<seed>_<optionId>_<optionId>_..._<optionId>.json`, one
option id per moment, in order:

```
runs/scratch/seed-1_m0-honest_m1-modest_m2-honest_m3-modest_m4-honest.json
runs/scratch/seed-7_m0-honest_m1-bold_m2-honest_m3-bold_m4-upbeat.json
```

The ids come from the log itself, after the engine has checked them against
the content. As a second guard, any character outside `A-Z a-z 0-9 -` becomes
`-`, so a name can never point outside the folder. The same seed and choices
give the same name and the same bytes, so a repeat run replaces its file.

Each file is written to a temporary file in the same folder (`.run-*.tmp`)
and then renamed, so a reader never sees half a file. If the write fails
(say the folder can't be created), the server logs the error and still
answers 200 with the full log.

## Size

A full run is about 450–480 KB of compact JSON (447 KB for the startup run,
478 KB for seed 7 above). Measured on seed 7, by field:

| Part | Bytes | Share |
|---|---|---|
| `rounds[].paths` | 218 KB | 46% |
| `rounds[].events` | 169 KB | 35% |
| `rounds[].perception`, `interest` | 48 KB | 10% |
| `town` | 21 KB | 4% |
| `map` | 15 KB | 3% |
| `start`, `moments`, the rest | 2 KB | under 1% |

## Fields

### Top level

| Field | Type | Meaning |
|---|---|---|
| `label` | string | Always `"SIMULATED"`. The UI must show it. |
| `company` | string | The fictional company's name. |
| `seed` | number | The run's seed, 0 to 2^53 − 1. Same seed, choices and map give the same log. |
| `town` | Town | The town before round 0. |
| `map` | WalkMap | The walk graph that `start` and `paths` index into: the city's or the town's. |
| `start` | number[] | `start[b]` is blob `b`'s node before round 0. One entry per blob. |
| `rounds` | Round[] | One per round played: 50 for a finished run, 10 × choices for a partial one. |
| `moments` | MomentLog[] | The announcements chosen so far, in order. |
| `next` | Pending or null | The next moment to choose for, or `null` when the run is over. |

### `town`

| Field | Type | Meaning |
|---|---|---|
| `blobs` | Blob[] | Every blob; `blobs[i].id == i`. |
| `families` | Family[] | Families of parents and children. |
| `homes` | Home[] | Who lives where. |

A **Blob**:

| Field | Type | Meaning |
|---|---|---|
| `id` | number | Index in `blobs`, and the id used everywhere else in the log. |
| `name` | string | Fictional name. |
| `shape` | string | `square`, `circle`, `triangle`, `star`, `tear` or `capsule`: the blob's culture, which sets whom it trusts. |
| `age` | number | Years, 0–94. Child 0–17, adult 18–64, elder 65+. |
| `traits` | string[] | Tags: `skeptic`/`gullible`, `quiet`/`chatty`, `unconvincing`/`charismatic`, plus `family-oriented`, `recluse`, `leader`. |
| `perception` | number | Starting opinion of the company, 50. |
| `interest` | number | Starting interest, 20. |
| `familyId` | number | Index in `families`, or −1. |
| `homeId` | number | Index in `homes`. |
| `neighbourhoodId` | number | Neighbourhood 0–4. |

A **Family** has `id`, `parents` (blob ids), `children` (blob ids) and
`homeId`. A **Home** has `id`, `neighbourhoodId`, `familyId` (−1 if none) and
`residents` (blob ids).

### `map`

| Field | Type | Meaning |
|---|---|---|
| `nodes` | [x, z][] | Position of each walk-graph node, in world units, rounded to 0.001. X points east, Z points south. |
| `stand` | number | `nodes[0:stand]` are the standing spots, in the map's gathering order (752 in the city, 780 in the town). The rest are extra walking nodes on crosswalks, in front of doors and round corners. |
| `ticksPerRound` | number | Moves per round, 10. Each path has `ticksPerRound + 1` entries. |

The graph's edges are not in the log. Every move in a path is along an edge
or a stay, so consecutive entries are always neighbours or equal.

`POST /api/run` takes an optional `"map"` of `"city"` (the default) or
`"town"`, so the same seed and choices can be watched on either map. The map
changes only the paths and the `map` object; the social step, scores and
announcements are the same.

### `rounds[]`

| Field | Type | Meaning |
|---|---|---|
| `i` | number | Round index, 0–49. |
| `events` | RunEvent[] | What was said, posted or read this round, in the order it happened. |
| `perception` | number[] | Each blob's perception after the round, by id, 0–100, rounded to 0.1. |
| `interest` | number[] | Each blob's interest after the round's decay, by id, 0–100, rounded to 0.1. |
| `avgPerception` | number | Town average perception, rounded to 0.1. |
| `avgInterest` | number | Town average interest, rounded to 0.1. |
| `paths` | number[][] | `paths[b][k]` is blob `b`'s node after `k` ticks of this round's movement. `k = 0` is where the round starts: the previous round's last entry, or `start[b]` in round 0. |

Movement happens before the talking in each round, so `paths` is where blobs
walked while that round's news went round.

A **RunEvent** is one conversation, one post, or one scroll:

| Field | Type | Meaning |
|---|---|---|
| `f` | number | The blob who spoke, posted or scrolled. |
| `to` | number[] | Who heard it: one blob for a talk, 8 readers for a post, or the poster for a scroll. |
| `p` | boolean | `true` for a social media post, `false` otherwise. |
| `s` | boolean | `true` for a scroll: `f` read `to[0]`'s post. Omitted when false. |
| `c` | number | Claim strength told or read, 0–100, rounded to 0.1. Retellings drift upward. |
| `dp` | number[] | Perception change for each blob in `to`, same order. For a scroll, the reader's change. |
| `di` | number[] | Interest change for each blob in `to`, same order. For a scroll, the reader's change. |
| `w` | string | What `f` said or posted. For a scroll, the post `f` read. Written after the run by the voice ([THINKING.md](../THINKING.md)); empty in `sim.Run`'s own output. |
| `t` | string | What `f` thought: why it spoke, or how it took the post it scrolled to. |
| `r` | string[] | What each blob in `to` thought on hearing it, same order. Empty for a scroll. |

The words never change a number: the formulas decide every event and score, then the voice
(`BRAIN=stub` templates by default, or a model with `BRAIN=anthropic`) explains them in character.

### `moments[]`

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Moment id, e.g. `m0-assistant`. |
| `round` | number | Round it was announced: 0, 10, 20, 30 or 40. |
| `optionId` | string | The option the player chose, e.g. `m1-bold`. |
| `headline` | string | That option's headline. |
| `claimed` | number | What the company claimed, 0–100. |
| `delivered` | number | What actually shipped, 0–100. |
| `shipped` | boolean | Whether it has shipped (8 rounds after the announcement). |
| `shippedRound` | number | The round it shipped at, or −1. |
| `broken` | boolean | It shipped and `claimed − delivered > 15`: a broken promise. |
| `credibility` | number | Town credibility after this ship (or now, if not shipped), 0.30–1.00. |

### `next`

`null` when the run is over. Otherwise the moment the player must choose for:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Moment id. |
| `round` | number | Round it will be announced at. |
| `feature` | string | The feature being announced. |
| `options` | Option[] | The choices: `id`, `headline`, `text`, `claimed`, `delivered`. |

## An excerpt

The startup run (seed 1), cut down, with notes after `//` (JSON itself has
no comments):

```
{
  "label": "SIMULATED",
  "company": "Outrage AI Company",
  "seed": 1,
  "town": { "blobs": [
    { "id": 0, "name": "Opal Oysterbed", "shape": "tear", "age": 50,
      "traits": ["gullible", "charismatic"], "perception": 50, "interest": 20,
      "familyId": -1, "homeId": 17, "neighbourhoodId": 1 }, ... ], ... },
  "map": {
    "nodes": [[0, 0], [-1.8, 0], [1.8, 0], ...],   // 1,054 nodes; node 0 is the plaza's centre
    "stand": 752,
    "ticksPerRound": 10
  },
  "start": [25, 612, 586, 188, 663, ...],          // blob 0 starts on node 25
  "rounds": [
    { "i": 0,
      "events": [
        { "f": 1, "to": [52], "p": false,            // blob 1 told blob 52 in person
          "c": 43.2, "dp": [0.6], "di": [1.2] }, ...],
      "perception": [54.5, 51.6, 50, ...],
      "avgPerception": 50.9, ...,
      "paths": [
        [25, 25, 25, 25, 25, 25, 32, 32, 25, 25, 7],  // blob 0: dwelling, pushed aside to 32
                                                      // and back, then off towards a new goal
        [612, 612, 612, 612, 612, 612, 865, 610, 864, 863, 608],
        ... ] },
    ... ],
  "moments": [
    { "id": "m0-assistant", "round": 0, "optionId": "m0-honest",
      "headline": "Outrage AI Company launches Wick, a chat assistant in beta",
      "claimed": 40, "delivered": 40, "shipped": true, "shippedRound": 8,
      "broken": false, "credibility": 1 }, ... ],
  "next": null
}
```

## `jq` recipes

Set `F` to a log file first, e.g.
`F=runs/scratch/seed-7_m0-honest_m1-bold_m2-honest_m3-bold_m4-upbeat.json`.

Blob 3's positions over the whole run, as `[x, z]` coordinates (501 of
them: the start plus 10 per round):

```
jq -c '.map.nodes as $n | [.start[3]] + [.rounds[].paths[3][1:][]] | map($n[.])' $F
```

Where everyone stands at the end of round 20:

```
jq -c '.map.nodes as $n | [.rounds[20].paths[][-1] | $n[.]]' $F
```

Who talked to whom in round 12 (in person only), by name:

```
jq -r '.town.blobs as $b | .rounds[12].events[] | select(.p | not)
       | "\($b[.f].name) -> \($b[.to[0]].name) (claim \(.c))"' $F
```

Average perception per round:

```
jq -c '[.rounds[].avgPerception]' $F
```

The round each moment was announced and shipped, and whether the promise
broke:

```
jq -c '.moments[] | {optionId, round, shippedRound, broken, credibility}' $F
```

Total steps walked by all blobs over the run:

```
jq '[.rounds[].paths[] | [range(1; length) as $k | select(.[$k] != .[$k-1])] | length] | add' $F
```

Shape, rounds and size at a glance:

```
jq -c '{rounds: (.rounds | length), blobs: (.start | length), nodes: (.map.nodes | length),
        pathLengths: ([.rounds[].paths[] | length] | unique), next}' $F
ls -l $F
```

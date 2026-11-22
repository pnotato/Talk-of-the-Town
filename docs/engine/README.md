# The engine

"The engine" is the Go code that plays a run of Talk of the Town: `sim.Run`
in `internal/sim`. Given a seed and the player's choices, it plays up to 50
rounds and returns a **RunLog**, a single JSON document that holds everything
the client needs to replay the run. The client never simulates anything; it
only plays the log back.

Every run is SIMULATED: the company, its announcements and every blob are
fictional.

## One round

Each round runs the same three steps, in this order
([MODEL.md#round-order](../MODEL.md#round-order)):

1. **Announce or ship.** On rounds 0, 10, 20, 30 and 40 the company announces
   the story the player picked. Eight rounds later (8, 18, ...) the feature
   ships and blobs compare it with what they heard.
2. **Movement: 10 ticks.** Every blob takes up to 10 steps round the city.
   Each step is one edge of the walk graph (at most 1.95 units) or standing
   still. Blobs walk to a goal, wait there a while, then pick another goal.
   No two blobs ever share a spot, walk through each other, or come closer
   than 1.2 units (two body radii), even halfway through a step.
   ([MODEL.md#movement](../MODEL.md#movement))
3. **Social step.** Blobs talk one-to-one, post, or idle; scores move; interest
   decays; town averages are recorded
   ([MODEL.md#actions](../MODEL.md#actions)).

Movement and the social step don't read each other yet. Walking changes no
score, and who talks to whom doesn't depend on where blobs stand.

## The pipeline

```
web/src/scene/            the city and town layouts in TypeScript: areas,
     |                    standing spots, crosswalks, obstacles
     |  make maps        (web/scripts/export-city-map.ts, export-town-map.ts)
     v
internal/sim/citymap/{city,town}.json   committed; make check fails if stale
     |  citymap.Graph() or citymap.TownGraph() = Load + nav.Build,
     |  once per process per map (~195 ms for the city)
     v
nav.Graph                 1,054 nodes for the city; 126 for the town, plus
     |                    the hop matrix and the move-conflict table
     |  walker (sim/walk.go): goals, dwell times, priorities
     v
nav.Planner.Step (PIBT)   once per tick, 10 ticks per round
     |
     v
sim.Run / sim.RunMap      town, map, start, and per round: paths, talk
     |                    events, scores, averages; moments
     |  internal/server encodes it once
     +---------------->  POST /api/run response  ->  the web client replays it
     +---------------->  runs/scratch/seed-<seed>_<options>.json  (finished runs)
```

## Same seed, same run

A run is fully determined by its seed and choices. Two random sources are
used, both seeded from the run's seed:

- `NewRNG(seed)` drives the town and the social step.
- `NewMoveRNG(seed)` drives movement only: spawn spots, goals, dwell times
  and the planner's tie-breaks.

Keeping movement on its own source means adding it changed no score, and
paths depend on the seed alone. A run with 2 choices is an exact prefix of
the same seed's run with 5 choices, paths included
([MODEL.md#movement-rng](../MODEL.md#movement-rng)).

## How to run it

```
cp .env.example .env    # once
make dev                # Go server on :8080, Vite on :5173
```

With `make dev` (or `make server`), the server writes JSON run logs to
`runs/scratch/` (git-ignored):

- On start, before it listens, it plays seed 1 with the first option of every
  moment and writes
  `runs/scratch/seed-1_m0-honest_m1-modest_m2-honest_m3-modest_m4-honest.json`.
- Every finished run the client asks for (all 5 choices made) is written too,
  as the exact bytes the client received. Partial runs are not written.

The folder comes from `RUNS_DIR`. The Makefile sets it to `runs/scratch`
unless `.env` or your shell sets it; set it to empty to write nothing. A bare
`./bin/server` without `RUNS_DIR` writes nothing.

To ask for a run by hand:

```
curl -s localhost:8080/api/run \
  -d '{"seed":7,"choices":["m0-honest","m1-bold","m2-honest","m3-bold","m4-upbeat"]}' \
  | jq '.rounds | length'
```

[RUN_LOG.md](./RUN_LOG.md) describes every field in the file and has more
`jq` recipes.

## Read more

- [NAV_GRAPH.md](./NAV_GRAPH.md): how the walk graph is built from the city
  map, and the rules every graph must keep.
- [PIBT.md](./PIBT.md): how the planner moves 100 blobs a tick without
  collisions, and why they keep reaching their goals.
- [RUN_LOG.md](./RUN_LOG.md): the log format, file names and `jq` recipes.
- [../MODEL.md](../MODEL.md): every number in the simulation, with sources.

## Where in the code

| File | What it does |
|---|---|
| `internal/sim/run.go` | `Run`: checks the choices, builds the town and the walker, plays the rounds, ships stories |
| `internal/sim/round.go` | `State.Step`: the social step. Also the `Round` and `RunLog` structs |
| `internal/sim/walk.go` | `walker`: spawn, goals, dwell, priorities, one round of paths. `WalkMap`, `NewMoveRNG` |
| `internal/sim/rng.go` | `NewRNG`, the social random source |
| `internal/sim/citymap/` | `city.json` and `Graph()`, which builds the city's walk graph once |
| `internal/sim/nav/` | `Build` (map to graph), `Graph`, `Planner` (PIBT) |
| `internal/server/server.go` | `POST /api/run`: parse, check caps, `sim.Run`, encode once, respond |
| `internal/server/runs.go` | `WriteRun` (temp file and rename), `WriteSampleRun` (the startup run) |
| `cmd/server/main.go` | reads the config, writes the startup run if `RUNS_DIR` is set, serves |
| `cmd/gentypes/` | writes `web/src/generated/types.ts` from the Go structs (`make types`) |

## How it is checked

- `internal/sim/walk_test.go` runs the walker on small hex and ring graphs. It
  checks spawn spots, the goal filter, dwell lengths and priorities, and, on
  every tick, clearance recomputed from coordinates. It also checks
  determinism, liveness, and that a tick doesn't allocate.
- `TestInvariants` (`golden_test.go`) plays 10 seeds × 4 strategies on the
  real city. It rechecks every tick from the graph's coordinates, checks that
  every strategy gives the same paths, and checks that partial runs are
  prefixes.
- `TestGolden` pins one whole run byte for byte in
  `internal/sim/testdata/golden_run.json` (447 KB).
- `TestCityWalkLiveness`: over a 50-round run on the city (seeds 1–10), every
  blob reaches at least 16 goals; the mean is 23.3, and no walker needs step 4
  of [MODEL.md#each-tick](../MODEL.md#each-tick).
- `internal/server/runs_test.go`: file equals response, partial and unset
  `RUNS_DIR` write nothing, an unwritable folder still answers 200, names are
  sanitised, and the startup run is written.
- `BenchmarkRun`: a full run takes about 16 ms on an Apple M1, 12.8 ms of it
  movement. The city graph is built once beforehand.

## Known limits

- Step 4 of [MODEL.md#each-tick](../MODEL.md#each-tick) (a walker that has
  not moved for 10 ticks takes a new goal) is a rare backstop. It fired 5
  times in 200 runs (seeds 1–200), once each in 5 of them, and turning it off
  changes no result on seeds 1–40. It used to fire about 14 times per run.
  Then 72 of the city's nodes had a trap entry: a blob stepping in from one
  side clashed with every way out, so whoever stood there could not be pushed
  on, and a walker behind them stalled. `CheckGraph` rule 4 now rules these
  out, and the graph builder leaves none
  ([NAV_GRAPH.md](./NAV_GRAPH.md#5-edges-and-trap-entries-1954-edges)).

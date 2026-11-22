# The walk graph

How the city's walkable ground becomes the graph the planner moves blobs on:
where the geometry comes from, how `nav.Build` turns it into nodes and edges,
the rules the result keeps (and why each one matters for blobs never touching),
and the numbers for the real city.

How blobs then move on the graph, one edge per tick and without collisions,
is in [PIBT.md](./PIBT.md).

![The city's walk graph: 1,054 nodes coloured by kind on the plaza, the park and the sidewalks round them, joined by black edges, with zebra chains across the roads](./city-graph.svg)

*Blue: standing spots. Orange: grid gaps filled in (mostly in front of doors).
Purple: chains across zebra crossings. Red: bridges round block corners and
other tight gaps. Dark boxes are buildings and kiosks; green discs are lamps
and trees. Everything is SIMULATED.*

## Where the geometry comes from

The TypeScript scene owns the city's layout. The Go side never recomputes it;
it reads an export.

```
web/src/scene/layoutCity.ts      the city: blocks, plaza, park, lamps, trees, standing spots
web/src/scene/cityMapExport.ts   picks out what walking needs
        │  make citymap  (node web/scripts/export-city-map.ts)
        ▼
internal/sim/citymap/city.json   committed; make check fails if it is stale
        │  go:embed, citymap.Load()   strict decode and validation
        ▼
nav.Map                          areas with spots, crosswalks, discs, boxes
        │  nav.Build(m, nav.DefaultParams())
        ▼
*nav.Graph                       citymap.Graph() builds it once and caches it
```

`city.json` (version 1) holds:

- **34 areas**, each an axis-aligned rectangle with its standing spots: the
  plaza, the park lawn and 32 sidewalk strips. Concatenated in order, the
  **752 spots** are the Stand nodes 0..751, the only places a blob may stand
  and the only possible goals.
- **24 crosswalks**, kerb to kerb across the road, each with the axis a blob
  walks along to cross.
- **50 discs** (36 lamps, 14 park trees) and **15 boxes** (13 buildings, 2
  kiosks): the obstacles. Doorsteps are left out on purpose: blobs never
  *stop* in front of a door, but walking past one is fine.

`citymap.Load` rejects unknown fields, trailing data, another version, a blob
radius other than `nav.DefaultParams().Radius`, a spacing other than 1.8, and
any spot off its area's hex grid or closer than a radius to its area's edge.
A stale or hand-edited file fails loudly instead of building a subtly wrong
graph.

## The rules a graph must keep

Every edge is one step a blob may take in one tick. The planner's guarantee
(no two blobs ever closer than `MinSep = 1.2`, two body radii) holds only if
the graph keeps these rules. `nav.Check` checks them all by brute force, and
`Build` refuses to return a graph that fails:

| Rule | Limit | Why |
|---|---|---|
| Nodes are apart | ≥ `MinSep` 1.2 | two blobs standing on neighbouring nodes don't overlap |
| Edges keep clear of other nodes | ≥ `MinSep` | a blob walking an edge never brushes one standing still nearby |
| Edges are short | ≤ `MaxEdge` 1.95 | a step fits in one tick, and the move-conflict table stays local |
| No trap entries | from every neighbour, some way on with swept gap ≥ `MinSep` | a blob dwelling on a node can always be pushed on by one arriving from any side; otherwise the arriving walker stalls behind it for good (pockets excepted) |
| Conflict table is exact | matches `Swept` | the planner looks clashes up instead of computing them |
| Stand nodes are the spots | equal, in order | goals and spawn points line up with the scene |
| Nodes and edges stay on the ground | inside areas ∪ crosswalks | nobody walks on the road except on a zebra |
| …and off obstacles | ≥ `Radius` 0.6 | a blob's body never enters a lamp, tree, kiosk or wall |
| One piece | every node reaches node 0 | every blob can reach every goal |
| Every crosswalk is crossed | a chain of edges inside it | the city's blocks are joined only where the zebras are |

The first five are `CheckGraph` (in `graph.go`); `Check` adds the geometry.

A *trap entry* is a neighbour `a` of `v` such that a blob stepping `a → v`
clashes with every move on out of `v` (to any `b ≠ a`). A blob dwelling on
`v` then cannot be pushed on by a walker coming from `a`: the walker keeps
pushing, the dweller keeps failing, and the walker, which outranks it, waits
for ever. On a 1-wide corridor that is a turn too sharp for a queue; at a
T-junction it is a 90° turn with short legs; at the end of a hex row it is a
120° turn either way. A *pocket*, a node whose only two neighbours are linked
to each other (the 60° corner of a hex area), is exempt: nobody needs to pass
through it, and `GoalOK` never makes it a goal (see PIBT.md).

```
 corridor v            T-junction v              pocket v
   a ── v              b ── v ── c                a ─── b
        │                   │                      ╲   ╱
        b                   a                       v
 a→v then v→b:        a→v then v→b or v→c:     a and b are linked, so
 ≥ 1.2 apart          one must stay ≥ 1.2      nobody needs to pass v
```

## The build, stage by stage

`nav.Build` is pure and deterministic: standard library only, no clock, no
randomness, no map iteration, and every computed coordinate rounded to 1e-6.
Edges are never chosen one by one. They follow from the nodes by one rule
(the *edge rule*, `linkable`): two nodes link if they are at most `MaxEdge`
apart and the segment between them stays on walkable ground, keeps `Radius`
from every obstacle and `MinSep` from every other node. Every stage up to the
last just adds (or removes) nodes. Each addition is all-or-nothing: it is
kept only if it does what it was for, doesn't split the graph, and adds no
trap entry anywhere. The last stage cuts the trap entries that are left.

Numbers in brackets are for the real city.

### 1. Standing spots (752 nodes, 81 pieces)

The spots, in order, become Stand nodes 0..751. With the edge rule alone they
fall into 81 separate pieces. Sidewalks are cut at every doorway and don't
meet round block corners, the park lawn doesn't reach its sidewalks, and
nothing crosses a road.

### 2. Grid fill (+153 → 905 nodes, 30 pieces)

Spots keep a blob's *reach* (0.85) from obstacles and doorsteps, so it can
idle without clipping. A blob only passing through needs just its *radius*
(0.6), and doorsteps don't block it. So each area's hex grid is rebuilt from
its first spot, and every cell that is inside the area, a radius from the
walkable outline and from obstacles, and at least `FillGap` (1.4) from every
node so far, becomes a Fill node. It goes area by area, narrowest first,
row by row, and an area's grid reaches one step into the areas beside it.

This refills the holes in front of doors and joins the park lawn to its
sidewalks. The clearance is measured to the outline of all walkable ground,
not the area's own rectangle, because where a lawn meets its sidewalk there
is no kerb.

![Doors on the news tower's north sidewalk: orange Fill nodes complete the row where doorsteps removed spots](./city-graph-doorway.svg)

The order matters where the park's lawn meets its sidewalks. The sidewalks'
rows line up with the lawn's even rows, so on the lawn's grid the row of
cells between would sit square under the sidewalk's spots, 1.515 away. A
blob stepping off the lawn onto the 1-wide sidewalk would then have to turn
90° either way on legs of 1.515 and 1.8. Those moves come within 1.159 of
each other, under `MinSep`, so every such step would be a trap entry. Filling
the sidewalks first puts that row on the sidewalk's grid instead, half a step
along, joined to the sidewalk by triangles. It takes the nodes with a trap
entry after this stage from 83 to 38.

![The park's south-east corner: the orange row between the lawn and the south sidewalk sits half a step along from the sidewalk's spots, joined to them by triangles](./city-graph-park-edge.svg)

### 3. Crosswalk chains (+120 → 1,025 nodes, 18 pieces)

Roads are 7 wide and edges at most 1.95, so each crosswalk needs a chain of
nodes. For each one:

1. **Land.** From the kerb point on the crosswalk's centreline, route to the
   nearest node on that side of the road: Dijkstra on a 0.1 grid,
   8-neighbour, integer costs 10 and 14, ties to the lower cell index,
   keeping `Radius + Margin` (0.7) from obstacles.
2. **Pull straight.** Shortcut the grid path wherever the straight line stays
   clear, leaving a few straight segments.
3. **Join** landing, centreline, landing into one line from a node on one
   side to a node on the other.
4. **Place nodes** along it with a small dynamic program: as few new nodes as
   possible, steps as close to `ChainStep` (1.75) as they can be, each step
   passing the edge rule, new nodes at least `BridgeGap` (1.25) from
   everything, and every new node passable as a corridor. An existing node
   within 1.0 of the line can be used on the way instead of crowding it. It
   first asks for an extra `Margin` (0.1) on every limit, and drops that only
   if nothing fits.

All 24 succeed. Straight landings would fail at the two plaza mouths wedged
between a kiosk and a corner lamp. Routing goes round the kiosk:

![The plaza's north-east corner: purple chains cross both roads; on the plaza side the chain bends round the kiosk to reach the paving](./city-graph-crosswalk.svg)

### 4. Gap bridges (+47 Bridge, −18 Fill → 1,054 nodes, 1 piece)

What is left are places where two nodes are a short walk apart but the graph
only links them the long way round, or not at all. The worst are block
corners. A corner lamp stands 0.8 in from both kerbs, and the gap between it
and the building corner is only about 0.9 wide for a blob's centre. The
nearest spots on two sidewalks meeting at a corner are 3.4 to 6.9 apart.

Every pair of nodes 1.95 to 7.5 apart is a candidate if walkable ground runs
straight between them and the graph needs more than `ceil(d / 1.8) + 4` hops.
Candidates go shortest first. A pair is skipped if either end has no room for
a new node within a step, ignoring Fill nodes, which may be cleared. The
park's west edge is the main such case: the lawn's grid and the sidewalk's
zigzag end up 2.2 to 2.4 apart, just over one step, with no room between.
Each remaining pair gets, until one works:

1. a **routed chain** (A* on the 0.1 grid, pulled straight, nodes placed as in
   stage 3, with the margin), first as is and then after clearing the Fill
   nodes crowding its line;
2. **one, then two hand-placed points** on a 0.05 grid round the pair, chosen
   to leave the most room against every limit (obstacles, spacing, edges
   brushing nodes, passing through), first as is and then with the window's
   Fill nodes cleared (Stand nodes are never removed);
3. a routed chain **without** the margin, as a last resort.

Every bridge must also add no trap entry, which rules out bridge nodes at
T-junctions with legs too short for a 90° turn (about 1.7 each).

On the real city that is 12 routed chains, 16 one-point and 9 two-point
bridges, with 18 Fill nodes cleared to make room. The five tightest corners,
where an east sidewalk's zigzag meets its north or south sidewalk, take two
points each and leave at least 0.11 to spare. To get that room some swing
out to 0.4 from the kerb, so a blob rounding the corner leans 0.2 over the
road. That is allowed: only obstacles block.

![Block [1,-1]'s north-east corner: the north sidewalk's row and the east sidewalk's zigzag joined by two red Bridge nodes threaded between the corner lamp and the building](./city-graph-corner.svg)

### 5. Edges and trap entries (1,954 edges)

Nodes cut off from Stand node 0 would be removed (there are none). The edge
rule then links every pair one last time, which leaves 28 trap entries, all
at the ends of hex rows: on the plaza's east and west edges, down the lawn's
west side, and at the ends of the fill rows. Each is fixed by cutting an
edge, `untrap` in `untrap.go`. For entry `a → v` it tries cutting `a-v`, then
each other edge of `v`, which can leave `v` a pocket or a dead end. A cut must
never split the graph or uncross a crosswalk. Within that, it prefers, in
order:

1. cuts that lower the trap entries round them without costing a goal;
2. cuts that just move a trap on along a row, which the end of a row can need;
3. only if nothing else is left, cuts that cost a goal.

Every cut drops an edge, so it ends. On the city all 28 go with the first
kind and no goal is lost. If any trap entry is left, `Build` returns an error
listing them rather than a graph that would stall walkers. If any Stand node
is unreachable at the end, `Build` returns an error. It never drops a spot.

`nav.Untrap` runs the same cuts on a hand-made edge list. The hex test
fixtures go through it, as the city does.

Finally `FromEdges` builds the planner's tables and `Check` re-verifies
everything above.

## The real city

| | |
|---|---|
| Nodes | 1,054: 752 Stand, 135 Fill, 120 Crossing, 47 Bridge |
| Edges | 1,954 (28 cut to leave no trap entry) |
| Pieces | 1 |
| Closest two nodes | 1.2886 (`MinSep` 1.2) |
| Trap entries | 0 |
| Dead ends | 0 |
| 2-core | all 1,054 nodes |
| Possible goals (`GoalOK`) | 750 of 752 Stand nodes (99.7%); the other 2 are pockets |
| Fingerprint | `0x2f8815783ff8d06d`, the same on arm64 and amd64 |
| Build time | ~195 ms on an Apple M1, of which `Check` is ~50 ms |

Per stage: fill ~4 ms, crosswalk chains ~20 ms, gap bridges ~100 ms, then
the trap cuts, `FromEdges` and `Check`. `nav.BuildReport` returns the counts
above stage by stage; `TestGraph` logs them.

Before trap entries were ruled out (1,050 nodes, 72 of them with one),
walkers stalled behind blobs they could not push. `sim`'s step 4, a new goal
after 10 ticks standing still, fired about 14 times per run, and without it
29 of 40 seeds had a blob reach fewer than 2 goals in a run. Now it fires 5
times in 200 runs, and turning it off changes nothing on seeds 1–40: every
blob reaches at least 15 goals per run, 23.3 on average.

## Why builds are bit-stable

The graph's shape depends on hundreds of threshold tests (is this 1.95 or
1.9500001?), so the same input must give the same bits on every machine:

- Every product in a threshold test is wrapped in `float64(...)`. That stops
  Go fusing `a*b + c` into one FMA instruction, which it does on arm64 but not
  on default amd64, and which rounds differently.
- Computed node coordinates are rounded to 1e-6.
- Spatial lookups use a dense bucket grid and return ids sorted, never Go map
  iteration order. Routing breaks ties by cell index.
- The builder keeps 1e-7 inside the limits `CheckGraph` tests with slightly
  different formulas (`math.Hypot`, `Swept`).

`TestGraph` pins the fingerprint, so any change to the city or the build shows
up as a failing test. The arm64 and amd64 builds give the same fingerprint
(checked by running the amd64 test binary under Rosetta).

## Regenerate and inspect

```sh
make citymap                                   # re-export city.json after changing the scene
go test ./internal/sim/citymap -run TestGraph -v   # stage counts, trap cuts, spacing, 2-core, goals, fingerprint
go test ./internal/sim/citymap -run TestSVG \
    -svg ../../../docs/engine/city-graph.svg   # this page's pictures (crops go next to it)
go test ./internal/sim/citymap -run XXX -bench . -benchtime 10x   # Build and Check timings
```

If the fingerprint changes on purpose, look at the new picture, update
`cityFingerprint` in `citymap_test.go`, and say why in the commit.

## Where in the code

| File | What |
|---|---|
| `internal/sim/citymap/city.json` | the exported geometry (`make citymap`) |
| `internal/sim/citymap/citymap.go` | `Load` (strict decode, grid check), `Graph` (build once, cached) |
| `internal/sim/citymap/svg_test.go` | the pictures on this page, behind `-svg` |
| `internal/sim/nav/types.go` | `Map`, `Params`, `DefaultParams`, `Kind` |
| `internal/sim/nav/geometry.go` | distances, the walkable `union` (outline, segment containment), `obstacles`, the node index |
| `internal/sim/nav/build.go` | `Build`, `BuildReport`, stages 1 and 2, the edge rule (`linkable`), trap counts (`trapCount`), hops and pieces |
| `internal/sim/nav/chain.go` | grid routing (A* / Dijkstra), string pulling, chain placement (`placeChain`), all-or-nothing changes (`keeps`: no new trap entry) |
| `internal/sim/nav/stages.go` | stage 3 (`crossings`), stage 4 (`bridges`, `brute`), stage 5 (`prune`, `untrap`) |
| `internal/sim/nav/untrap.go` | trap entries and the cuts that remove them; `Untrap` for hand-made graphs |
| `internal/sim/nav/check.go` | `Check`: `CheckGraph` plus the map's geometry |
| `internal/sim/nav/graph.go` | `FromEdges`, `CheckGraph` (rule 4: no trap entries), `GoalOK` (see PIBT.md) |

## How it is tested

- **Geometry**: distances, segment/rect clipping, the union's outline and
  segment containment on an L with a crossing, obstacles, rounding, the node
  index.
- **Edge rule**: length, ground, a lamp 0.5 and 0.65 off, a bystander 1.1 and
  1.25 off, a segment cutting a corner.
- **Build on small maps**: one rect gives its hex grid less a few row-end
  edges, with pockets and dead ends never goals; a road with a crosswalk gives
  a chain on its centreline; without the crosswalk the build fails; a doorway
  gap is filled exactly; a copy of the tightest corner gets bridged; a
  walled-off gap fails; the park block's lawn meets its sidewalks on the
  sidewalks' grid, with no trap and no goal lost; a ladder of 90° rungs, which
  no cut can fix, makes the build fail naming the traps; bad input is
  rejected; two builds are identical.
- **Untrap**: nothing to cut, a hex patch, a rhombus and a ladder that can't
  be fixed, a bad edge.
- **CheckGraph rule 4** catches a T-junction (90° on legs of 1.515 and 1.8,
  swept 1.159) and a hex row's end (120° either way), and passes pockets and a
  T-junction with legs of 1.75.
- **Check catches**: a node nudged 0.3, a Stand node moved off its spot, a
  crosswalk narrowed off its chain, an edge through an obstacle, a node too
  near one, an edge leaving the ground, two pieces, an unchained crosswalk, a
  missing spot, a dropped conflict entry, a trap entry.
- **Real city**: `Load` and malformed inputs; `Graph()` is one piece with all
  752 spots, passes `Check` (so has no trap entry), loses no goal to the trap
  cuts, keeps ≥ 95% of spots as goals, and matches the pinned fingerprint.
- **Mutations** (each applied by hand and reverted): skipping crosswalk
  chains, skipping bridges, `MinSep` 1.0 in the edge rule, no obstacle
  clearance for edges, grid fill ignoring `FillGap`, skipping the trap cuts,
  filling areas in map order (lawn first), and letting bridges add trap
  entries each fail real-city tests, and all but the last fail small-map ones
  too; rule 4 checked only on corridors fails `CheckGraph`'s own tests.

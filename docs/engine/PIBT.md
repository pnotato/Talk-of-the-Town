# PIBT planner

How blobs walk around the city without bumping into each other: the
`internal/sim/nav` planner, what it guarantees, and where each piece lives in
the Go code.

How the walk graph itself is built from the map (areas, crosswalks,
obstacles) is covered in [NAV_GRAPH.md](./NAV_GRAPH.md).

## The job

The city is a fixed graph of about 1,000 nodes: standing spots on the hex
paving, plus extra nodes along crosswalks and round corners. Each tick, every
blob moves at most one edge (up to 1.95 units) or stays put. About 100 blobs
walk at once, each to its own goal, then dwell there and pick another goal.
This runs for as long as the replay lasts ("lifelong" pathfinding).

Each tick must satisfy three rules:

- no two blobs end on the same node;
- no two blobs swap nodes (they would walk through each other);
- no two blobs ever come closer than `MinSep = 1.2` (two body radii), at any
  moment during the tick, not just at the ends.

## Why not D* Lite

D* Lite (Koenig & Likhachev, 2002) plans a path for **one** agent and repairs
it cheaply when the **map** changes, such as a robot finding a new wall. Neither
fits here:

- Our map never changes. The hard part is blobs getting in each other's way,
  and that changes every tick.
- If each blob treats the others as walls, two blobs meeting head-on on a
  1-wide sidewalk each see a wall. Neither has a path, so both wait forever,
  or both step aside and back again. Something still has to decide who gives
  way, and D* Lite has no notion of that.
- It would also keep 100 separate search states and repair them all every
  tick as everyone moves.

PIBT (Priority Inheritance with Backtracking; Okumura et al., IJCAI 2019, and
the longer AIJ 2022 paper) is built for exactly our case: many agents, a fixed
graph, new goals all the time. It plans everyone together, one tick at a
time, and it decides who gives way by priority.

## The hop matrix: exact distances

PIBT needs to know, for any node, how far it is from a blob's goal. We work
this out once: `FromEdges` runs a breadth-first search from every node and
stores the hop counts in an `n × n` table of `uint16` (1,022 nodes take about
2 MB; `65535` means unreachable).

Because the table is exact, "closer to the goal" is always really closer.
There is no estimate that could send a blob the wrong way round a block.
Looking up a distance is a single array read. The table is symmetric, so the
planner reads the goal's row.

## PIBT step by step

Every blob has a priority, set by the caller, and a higher priority plans
first. A blob walking to a goal gains priority every tick until it gets
there; a dwelling blob has the lowest. (The test harness uses
`ticksSinceGoal << 16 | fixedTiebreak`, and dwellers get only the tiebreak.)

Each tick:

```
for each blob i, highest priority first:
    if i has not been planned yet: pibt(i, parent = none)

pibt(i, parent):
    candidates = i's neighbours plus its own node,
                 sorted by hops to i's goal, ties shuffled with the seeded rng
    for c in candidates:
        if someone already claimed c for next tick:  skip
        if c is the parent's node:                   skip   (no swapping)
        if moving i to c clashes with a claimed move: skip  (see next section)
        claim c for i
        if an unplanned blob k stands on c:
            if pibt(k, i) succeeds: return success   (k moved out of the way)
            else: k stays on c; drop i's move and try the next candidate
        return success
    i stays where it is (claims its own node)
    return failure
```

The key idea is **priority inheritance**. When `i` wants a node that `k` is
standing on, `k` is planned straight away, at `i`'s priority, and must find
somewhere else to go. If `k` cannot, `i` **backtracks** and tries its next
candidate.

### Worked example: a push down a corridor

A 1-wide corridor. A has high priority and is walking to node 4. B and C are
dwelling.

```
node:     0   1   2   3   4   5   6
tick 0:   A   .   B   C   .   .   .
tick 1:   .   A   B   C   .   .   .    A steps into free node 1
tick 2:   .   .   A   B   C   .   .    A pushes B, B pushes C
```

Tick 2 in detail:

1. `pibt(A)`: A's best candidate is node 2 (2 hops from its goal). A claims 2.
   B is standing there, so A calls `pibt(B, A)`.
2. B's candidates: its own node 2 (taken by A), node 1 (A's node, which would
   be a swap), node 3. B claims 3. C is standing there, so B calls
   `pibt(C, B)`.
3. C's candidates: node 3 (taken by B), node 2 (B's node), node 4 (free). C
   claims 4 and succeeds. So B succeeds, and so does A.

All three move together like a train. B follows A in a straight line, so the
two stay 1.8 apart all tick, which is well over 1.2.

If there were no room ahead (say C sat at a dead end), C would fail and stay.
B would then have nothing left and stay, and A would fall back to staying
too. Nobody moves, and nobody collides. `TestStepPushesAChain` and
`TestStepHeadOn` check these exact sequences.

## The move-conflict table and swept clearance

Plain PIBT only stops blobs sharing a node or swapping. Our blobs have
bodies, so we also need them to stay 1.2 apart while they move.

**Swept clearance.** Two blobs move in straight lines over the same tick, one
from `a0` to `a1` and the other from `b0` to `b1`. The gap between them is

```
w(t) = (a0 - b0) + t * ((a1 - a0) - (b1 - b0)),   0 <= t <= 1
```

Its length is smallest at `t* = clamp(-w(0)·dv / |dv|², 0, 1)`, where `dv` is
the second bracket. `Swept` returns `|w(t*)|`. Two moves **conflict** if
`Swept < MinSep` or they end on the same node.

**Following.** If blob A moves into node `v` just as blob B leaves `v`, and
B's path turns by angle θ, then with equal edge lengths `L`,
`Swept = L · cos(θ/2)`. On the 1.8 hex grid:

| B's turn at v | Swept | Allowed? |
|---|---|---|
| straight (0°) | 1.800 | yes |
| 60° | 1.559 | yes |
| 90° | 1.273 | yes |
| 120° | 0.900 | no |
| U-turn (swap) | 0 | no |

Following is the normal case: a queue of blobs walks down a corridor
together. A sharp turn is not allowed, because the leader cuts the corner
into the follower's path. A blob may follow round any turn up to about 96°
(on 1.8 edges). Three blobs rotating round a hex triangle are each making a
120° turn, so the table rejects that too (`TestStepRefusesTriangleRotation`).

**The table.** Every possible move gets an integer id: one "stay" per node and
one per directed edge (6,904 moves on the 1,022-node test graph).
`FromEdges` computes, once, the sorted list of moves each move conflicts with
(about 16 each). It only compares moves whose start nodes are within
`2 × longest edge + MinSep` of each other, using a coarse bucket grid.
Moves further apart cannot get close enough. During a tick, the planner
keeps a `move → blob` array of what has been claimed. "Does this move clash?"
means walking a short list and checking each entry against that array.

After `FromEdges`, the planner uses only integers. All floating-point work
happens once, with each product rounded explicitly so the compiler cannot
fuse it into a multiply-add. Fused results differ between amd64 and arm64,
and this way the same seed replays the same on every machine.

## What is guaranteed, and why

If the graph passes `CheckGraph`, every tick has **no shared node, no swap,
and every two blobs at least 1.2 apart throughout**.

- **No shared node.** A node can be claimed by only one blob, and every blob
  ends the tick holding exactly one claim (`TestStepTablesAgree` checks the
  bookkeeping after every tick).
- **No swap.** A blob never moves onto its parent's node. Any swap would have
  to be between a blob and the one it pushed, so that rule covers it. A swap
  also has `Swept = 0`, so the table rejects it as well.
- **Clearance.** Each move is checked, when it is claimed, against every move
  already claimed. A move is only un-claimed when the blob it pushed failed.
  In that case everyone in that failed branch stays put, and staying does not
  depend on anything else. So of any two final moves, the later one was
  checked against the earlier. The one move that is not checked is the
  fallback "stay". It is safe because `CheckGraph` requires nodes to be 1.2
  apart (rule 1) and every edge to pass 1.2 from every other node (rule 2),
  so a blob standing still can never be grazed.

The full argument is in the comment on `pibt` in `planner.go`. Every tick of
the property tests re-checks these rules from coordinates, without using the
table.

### Liveness: blobs keep reaching their goals

The PIBT papers prove that every agent eventually reaches its goal when
priorities grow while an agent waits, and when every edge lies on a cycle.
Our graph has dead ends and 1-wide corridors, so we add two conditions:

1. **Goals are in the 2-core.** The 2-core is what remains after repeatedly
   removing nodes with at most one neighbour, so dead-end spurs are left
   out. Two blobs inside a dead end, each wanting the other's spot, can never
   move: they cannot swap, and there is no room to step aside
   (`TestStepWedgesOnDeadEndGoals`). Blobs may still be pushed into a spur;
   they come back out because their goals are elsewhere.
2. **Pass-through rule (`CheckGraph` rule 4).** At a corridor node `v` with
   exactly two neighbours `a` and `b`, the moves `a → v` and `v → b` must not
   conflict. Otherwise a blob dwelling at `v` can never be pushed on through,
   because the pusher entering `v` would clash with it leaving, and the
   corridor would stay blocked. In practice, a corridor may turn at most
   about 93–96° at any one node.

Measured with the test harness over 2,000 ticks and 40 seeds (10 for the last
row). The fixtures run at three to four times the city's density; goal nodes
are the Stand nodes in the 2-core.

| Fixture | Blobs / goal nodes | Fewest goals by one blob | Mean | Longest wait |
|---|---|---|---|---|
| hex plaza with holes | 45 / 152 | 122 | 136 | 9 ticks |
| 1-wide ring | 9 / 24 | 96 | 112 | 3 |
| two rooms + 1-wide corridor | 21 / 70 | 53 | 66 | 17 |
| sidewalk rings + crosswalks | 12 / 40 | 81 | 96 | 8 |
| ring with dead-end spurs | 9 / 30 | 84 | 98 | 9 |
| 1,022-node hex, 100 blobs (city density) | 100 / 1022 | 110 | 120 | 5 |

The tests require at least 25 goals per blob and no wait over 40 ticks.

**Known limits.**

- 1-wide corridors between two rooms are in the 2-core but not on a cycle,
  so there is no formal guarantee there. Pushes work because the pushed
  queue ends up in a room with free space. Throughput drops with crowding:
  the corridor fixture at 50% density still worked, but the slowest blob
  managed only 27 goals.
- The pass-through rule only checks neighbours. A queue pushed round a very
  tight bend could still be refused because of two blobs that are not
  neighbours. Graph building should keep corridor bends gentle.
- `CheckGraph` rule 4 also flags 60° "pocket" nodes, such as the corner of a
  hex area, whose two neighbours are also joined to each other. These never
  block a path, but the rule as written rejects them, so graph building must
  avoid or drop them.
- The table forbids some moves plain PIBT would allow (triangle rotations,
  sharp-turn following), so blobs sometimes wait a tick longer.
- If a goal is unreachable, every candidate ties and the blob wanders at
  random.
- `Step` trusts that the graph passed `CheckGraph` and does not check it
  again.

## Cost

| | Complexity | Measured (Apple M1, 1,022 nodes, 2,941 edges) |
|---|---|---|
| `FromEdges` | conflict table about `n × k × d²` (k nearby nodes, d degree); hop matrix `n × (n + E)` time, `2n²` bytes | **13 ms** |
| `CheckGraph` | brute force: `n² + E·n + M²` (M moves) | 77 ms; for tests and build time, not per tick |
| `Step`, 100 blobs | `A log A` sort, then each blob planned at most once: `A × (d + 1) × c` (c ≈ 16 conflict entries) | **14 µs**, 0 allocations |

The test graph is denser than the city (about 5.8 neighbours per node against
about 3.6), so the city should be faster. `Step` reuses its scratch arrays and
never allocates (`TestStepNoAllocs`).

## Where in the code

| File | Function | What it does |
|---|---|---|
| `graph.go` | `FromEdges` | Validates nodes and edges, builds sorted adjacency, then the tables below |
| `graph.go` | `Swept` | Closest distance between two straight moves over one tick |
| `graph.go` | `buildConflicts` | Move ids and per-move conflict lists, via a bucket grid |
| `graph.go` | `buildHops` | All-pairs hop matrix by BFS from every node |
| `graph.go` | `buildCore` | 2-core by peeling nodes with at most one neighbour |
| `graph.go` | `Neighbors`, `Hops`, `Core`, `Conflicts`, `Fingerprint` | Read-only queries |
| `graph.go` | `CheckGraph` and `rule*` | Brute-force recheck of the five graph rules |
| `planner.go` | `NewPlanner` | Allocates scratch arrays once |
| `planner.go` | `Step` = `begin`, `plan`, `finish` | Checks inputs and sorts by priority; runs PIBT; writes `next` and clears scratch |
| `planner.go` | `pibt` | The recursion above, with the invariant argument |
| `planner.go` | `candidates` | Neighbours and stay, sorted by hops, ties shuffled |
| `planner.go` | `blocked` | Conflict-table lookup against claimed moves |
| `planner.go` | `claim`, `release` | Keep the node, move and agent tables in step |
| `planner_test.go` | `wander`, `checkMoves` | Lifelong test harness and the per-tick rule checks |

## How it is tested

- `graph_test.go`: a `Swept` table (parallel, head-on, follow straight, 60°,
  120°, crossing, identical points), `FromEdges` errors, hops and 2-core on
  small graphs, fingerprint stability, conflicts, and `CheckGraph` catching
  each rule on a small broken graph.
- `planner_test.go`: the wander harness on five fixtures (hex with holes,
  1-wide ring, two rooms and a corridor, sidewalk rings with crosswalks, ring
  with spurs). It checks clearance and the bookkeeping on every tick, plus
  liveness, plain PIBT without the table, hand-checked pushes, determinism,
  and zero allocations.
- Each of these deliberate bugs makes a test fail: dropping the table check;
  allowing a swap with the parent; removing priority inheritance; staying
  without claiming the node; allowing goals off the 2-core.

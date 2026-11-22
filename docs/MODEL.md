# Model

Exact numbers for the simulation. `docs/BLOBS.md` says what blobs are like; this file says how many and how likely.
Every rule is cited or marked *(design)*. References use the numbering in [BLOBS.md](./BLOBS.md#references).
Section headings are stable anchors. Reference them from Go constants, e.g. `// MODEL.md#shapes`.

# Population

All counts are for a town of `N = 100` blobs. Counts are exact, not sampled: the generator places exactly these numbers and then shuffles *(design)*.
For other `N`, scale each count and round with largest remainder so totals still match *(design)*.

## Generation order

`NewTown(seed)` builds the town in this order, from one seeded RNG *(design)*:

1. Age groups ([#ages](#ages)).
2. Families ([#families](#families)), taking adults and children from step 1.
3. Shapes ([#shapes](#shapes)): families first, then everyone else.
4. Leaders ([#leaders](#leaders)).
5. Recluses ([#recluses](#recluses)).
6. Trait tags ([#traits](#traits)).
7. Homes and neighbourhoods ([#homes](#homes), [#neighbourhoods](#neighbourhoods)).
8. Starting scores ([#starting-scores](#starting-scores)).

## Ages

| Group | Ages drawn from | Count | Share | Source |
|---|---|---|---|---|
| Child | 0–17 | 20 | 20% | [3] |
| Adult | 18–64 | 60 | 60% | [3] |
| Elder | 65–94 | 20 | 20% | [3] |
| **Total** | | **100** | **100%** | |

- Shares round Statistics Canada's July 2025 estimates to tens: about 1 in 5 Canadians is 65+, and about 1 in 5 is under 18 [3]. The child share is an estimate (StatCan reports 0–14, not 0–17).
- Within a group, age is a uniform integer over the range, inclusive *(design)*.
- Elder ages stop at 94 *(design)*: 95+ is too few people to give a blob at N = 100.
- Children under 13 read social media but do not post ([BLOBS.md](./BLOBS.md#age)). Under uniform draws, expect about 14 of the 20 children to be under 13.

## Families

| Family type | Families | Adults each | Children each | Share of families | Source |
|---|---|---|---|---|---|
| Two-parent | 7 | 2 | see below | 70% | *(design)*, [15] |
| Single-parent | 3 | 1 | see below | 30% | *(design)*, [15] |
| **Total** | **10** | **17 adults** | **20 children** | **100%** | |

| Children in family | Families | Children | Share of families |
|---|---|---|---|
| 1 | 3 | 3 | 30% |
| 2 | 4 | 8 | 40% |
| 3 | 3 | 9 | 30% |
| **Total** | **10** | **20** | **100%** |

- 10 families *(design)*. This is the smallest count that places all 20 children with at most 3 children per family.
- Every child belongs to exactly one family *(design)*. No child lives without a parent.
- Every family has at least 1 parent and at least 1 child ([BLOBS.md](./BLOBS.md#special-traits)).
- Single-parent share is 30% of families with children. Single parents are common in Canada [15]; the exact share is *(design)*, unverified against census tables, chosen near the lone-parent share of families with children.
- Assign child counts to families by shuffling the list `[1,1,1,2,2,2,2,3,3,3]` *(design)*. Child count is independent of family type.
- Parents are drawn from Adults only (18–64) *(design)*. Elders are not parents in a family.
- Each parent is at least 18 years older than each of their children *(design)*. If a draw breaks this, redraw the parent's age within 18–64.
- Family sizes are therefore 2–5 blobs. Totals: 37 blobs in families (17 adults + 20 children), 63 not in a family.
- All members of a family share one shape ([BLOBS.md](./BLOBS.md#special-traits)).
- Trait tags are rolled per blob, not inherited [16].
- Family membership is shown as the special tag `family-oriented` on every family member *(design)*. It does not count toward the 1–3 tags in [#traits](#traits).

## Shapes

| Shape | Count | Share | Source |
|---|---|---|---|
| Square | 17 | 17% | *(design)* |
| Circle | 17 | 17% | *(design)* |
| Triangle | 17 | 17% | *(design)* |
| Star | 17 | 17% | *(design)* |
| Tear | 16 | 16% | *(design)* |
| Capsule | 16 | 16% | *(design)* |
| **Total** | **100** | **100%** | |

- Shapes are fictional cultures. No census maps onto them, so shares are equal *(design)*. 100 / 6 rounds to four 17s and two 16s.
- Which two shapes get 16 is fixed as above, not random *(design)*, so runs differ only by seed.
- Assign families first: give families 1–6 one shape each (shuffled), and families 7–10 four different shapes from the six (shuffled) *(design)*. No shape has more than 2 families; the largest two families total 10 blobs, below the 16 slots of any shape.
- Fill each shape's remaining slots from the 63 non-family blobs, shuffled *(design)*.
- Every shape has the same trait mix in expectation: tags are rolled after shape, independent of it ([BLOBS.md](./BLOBS.md#shape)). No shape is "the gullible one".

## Leaders

- Exactly 1 leader per shape, so 6 leaders ([BLOBS.md](./BLOBS.md#special-traits)).
- The leader is chosen uniformly from that shape's Adults and Elders *(design)*. Not a child.
- A leader is not a recluse *(design)*: a leader must talk in person.
- A leader may be a parent *(design)*.
- A leader always has `charismatic` ([BLOBS.md](./BLOBS.md#special-traits)). It fills the persuasiveness category; see [#traits](#traits).
- `leader` is a special tag. It does not count toward the 1–3 tags.
- Leader status never changes during a run ([BLOBS.md](./BLOBS.md#special-traits)).

## Recluses

| Group | Count | Share of town |
|---|---|---|
| Recluse | 5 | 5% |
| Not recluse | 95 | 95% |
| **Total** | **100** | **100%** |

- 5% recluse *(design)*. No verified source for a "stays home, online only" share; treat as tunable.
- Recluses are drawn uniformly from non-family, non-leader Adults and Elders *(design)*. A parent must talk to their child in person; a child cannot live alone.
- `recluse` is a special tag. It does not count toward the 1–3 tags.

## Traits

### Tag count

| Tags | Share | Source |
|---|---|---|
| 1 | 25% | *(design)* |
| 2 | 60% | *(design)* |
| 3 | 15% | *(design)* |
| **Total** | **100%** | |

- Most blobs have 2 tags, some 1 or 3 ([BLOBS.md](./BLOBS.md#traits)). The split is *(design)*.
- Counts are sampled per blob, not fixed. Expected tags per blob: 1.9.
- Max 1 tag per category ([BLOBS.md](./BLOBS.md#traits)).
- Only the 3 personality categories count. `family-oriented`, `recluse` and `leader` are extra.

### Tag choice

Per blob: roll the tag count, choose that many distinct categories uniformly at random, then pick low or high in each chosen category with these odds *(design)*:

| Category | Low tag | Low | High tag | High | Total |
|---|---|---|---|---|---|
| Credulity | `skeptic` | 50% | `gullible` | 50% | 100% |
| Socialness | `quiet` | 80% | `chatty` | 20% | 100% |
| Persuasiveness | `unconvincing` | 50% | `charismatic` | 50% | 100% |

- A category that is not chosen means average for that category.
- Each category is chosen with probability 1.9 / 3 ≈ 63%.

### Resulting tag rates

| Category | Low | Average (no tag) | High | Total |
|---|---|---|---|---|
| Credulity | 31.7% | 36.6% | 31.7% | 100% |
| Socialness | 50.7% | 36.6% | 12.7% | 100% |
| Persuasiveness | 31.7% | 36.6% | 31.7% | 100% |

- These follow from the two tables above; they are not separate inputs.
- `chatty` ≈ 13%: a small minority does most of the sharing [13], [14]. The exact share is *(design)*.
- Credulity and persuasiveness are symmetric *(design)*. Tag rates do not depend on shape or age ([BLOBS.md](./BLOBS.md#shape), [BLOBS.md](./BLOBS.md#age)).

### Leaders

- A leader's persuasiveness is fixed to `charismatic`. Roll the tag count as normal; persuasiveness is always one of the chosen categories, and the rest are chosen uniformly from credulity and socialness *(design)*.

## Homes

| Home type | Homes | Blobs each | Blobs | Source |
|---|---|---|---|---|
| Family home | 10 | 2–5 | 37 | [#families](#families) |
| Two-person home | 20 | 2 | 40 | *(design)* |
| One-person home | 23 | 1 | 23 | *(design)* |
| **Total** | **53** | | **100** | |

- Each family lives in one home together *(design)*.
- The 63 non-family blobs fill 20 two-person homes and 23 one-person homes *(design)*. One-person homes are 23 / 53 ≈ 43% of homes. This is above Canada's share of one-person households and is a simplification; mark as unverified.
- All 5 recluses live in one-person homes *(design)*. Fill the other 18 one-person homes and the 20 two-person homes from the remaining 58 non-family blobs, shuffled.
- Two-person homes are mixed shape: residents are drawn without regard to shape *(design)*. They act as bridges between shapes [28].
- Every blob has exactly one home. Homes never change during a run *(design)*.

## Neighbourhoods

| Neighbourhood | Homes | Share of homes |
|---|---|---|
| 1 | 11 | 20.75% |
| 2 | 11 | 20.75% |
| 3 | 11 | 20.75% |
| 4 | 10 | 18.87% |
| 5 | 10 | 18.87% |
| **Total** | **53** | **100%** |

- 5 neighbourhoods *(design)*.
- Shuffle the 53 homes and deal them round-robin into neighbourhoods 1–5 *(design)*. Neighbourhoods 1–3 get 11 homes, 4–5 get 10.
- Neighbourhoods are not sorted by shape *(design)*, so Tears' "neighbours, any shape" ([BLOBS.md](./BLOBS.md#shape)) mixes shapes.

## Starting scores

| Score | Start | Range | Source |
|---|---|---|---|
| `perception` | 50 | 0–100 | *(design)*, [BLOBS.md](./BLOBS.md#properties) |
| `interest` | 20 | 0–100 | *(design)*, [BLOBS.md](./BLOBS.md#properties) |

- Every blob starts with exactly these values. No noise *(design)*.
- 50 is neutral. 20 means most blobs have heard of the company but do not care yet.

## Names

- Each blob gets a unique fictional name. Draw without replacement from a fictional name list in content data *(design)*. No real people.

# Interactions

Numbers for the round loop. Turns [BLOBS.md#interactions](./BLOBS.md#interactions) into rules.
All randomness comes from the run's one seeded RNG, drawn in blob `id` order *(design)*. Same seed and choices give the same run.
The one exception is movement, which has its own seeded RNG ([#movement](#movement)).
`clamp(x, lo, hi)` limits `x` to `[lo, hi]`. Scores are `float64` inside the sim and rounded only for display *(design)*.

## Run state

Per blob, on top of [#starting-scores](#starting-scores) *(design)*:

| Field | Type | Range | Start | Reset |
|---|---|---|---|---|
| `heard` | float or none | 0–100 | none | none at each announcement |
| `sources` | set of speaker ids | 0–100 ids | empty | empty at each announcement |

- `heard` is the claim strength this blob currently believes the company made. None means it has not heard the current story.
- The company itself is source id `-1`.

Town-wide *(design)*:

| Field | Type | Range | Start |
|---|---|---|---|
| `broken` | int | 0–5 | 0 |
| `credibility` | float | 0.30–1.00 | 1.00 |

## Round order

Each round `r` (0–49) runs these steps in order *(design)*:

```
if r % 10 == 0: announce(story[r/10])          // #announcements
if r % 10 == 8: ship(story[r/10])              // #shipping
repeat 10 times: move every blob one tick      // #movement
for b in blobs (by id): act(b)                 // #actions
for b in blobs: b.interest += 0.03 * (10 - b.interest)   // #decay
record town averages
```

- Updates from a hearing apply at once, so a blob told something early in a round can retell it later that round *(design)*. Order is by id, so this stays deterministic.
- Movement and the social steps do not read each other yet: walking changes no score, and partner choice does not look at positions *(design)*.

## Movement

Between conversations the blobs wander the city on its walk graph, without ever bumping into each other.

| Constant | Value | Meaning | Source |
|---|---|---|---|
| `TicksPerRound` | 10 | movement ticks per round; each tick a blob moves at most one edge or stays put | *(design)* |
| `WanderMinHops` | 3 | fewest hops to a new goal | *(design)* |
| `WanderMaxHops` | 20 | most hops to a new goal | *(design)* |
| `DwellMinTicks` | 2 | shortest stay at a goal | *(design)* |
| `DwellMaxTicks` | 12 | longest stay at a goal (before any extra ticks, below) | *(design)* |
| `StuckTicks` | 10 | a walker that has not moved for this many ticks in a row picks a new goal (a rare backstop; see "Why step 4") | *(design)* |
| `MinSep` | 1.2 | closest two blobs ever get, standing or moving: 2 × the blob radius 0.6 | *(design)*, `nav.DefaultParams()` |

- The walk graph is the city's standing spots plus extra nodes on crosswalks and round corners ([engine/NAV_GRAPH.md](./engine/NAV_GRAPH.md)). An edge is at most 1.95 units long.
- Goals and spawn points are only nodes that `Graph.GoalOK` accepts: standing spots in the graph's 2-core that are not pocket corners *(design)*. Other goals can wedge blobs for good ([engine/PIBT.md](./engine/PIBT.md#liveness-blobs-keep-reaching-their-goals)).

### Movement RNG

Movement draws from its own source, `NewMoveRNG(seed)` = PCG(seed, `0x6d6f7665`), the second word being `"move"` in ASCII *(design)*. It is the one exception to "all randomness comes from the run's one seeded RNG":

- The social sim's draws are exactly what they were before movement existed, so movement changed no event, score or moment.
- Movement depends on the seed only, never on the player's choices. A run with fewer choices is still an exact prefix of the full run, paths included.

### Spawn

Before round 0, in this order *(design)*:

1. Positions: one node per blob, distinct, uniform over the goal nodes.
2. Tiebreaks: a random permutation of `0..n-1`, one value per blob, fixed for the run.
3. Each blob's spawn node is its goal, so on the first tick every blob arrives and starts dwelling for a random time (step 3 below). Departures are staggered.

### Each tick

Blobs update in id order *(design)*:

1. A dwelling blob counts down by 1, even if it was pushed off its node.
2. When its count reaches 0, it picks a new goal uniformly from the goal nodes `WanderMinHops..WanderMaxHops` hops from where it stands, leaving out every other blob's goal. If none qualifies, it dwells 1 more tick and tries again.
3. A walking blob standing on its goal starts dwelling for `DwellMinTicks..DwellMaxTicks` ticks, uniform. It dwells on that tick and the next ones, and picks a new goal on the tick its count reaches 0.
4. A walking blob that has not moved for `StuckTicks` ticks in a row picks a new goal the same way as in step 2, if one qualifies, and its `ticksSinceGoal` starts again from 0. If none qualifies, it keeps its goal.

Then every blob moves at once, in one PIBT planner step ([engine/PIBT.md](./engine/PIBT.md)):

- A dweller's goal is the node it is dwelling at, so it steps back if pushed off. Goals are therefore always distinct.
- Priority: `ticksSinceGoal × 2^16 + tiebreak` for walkers, `tiebreak` for dwellers. Higher plans first and wins. A walker gains priority every tick until it arrives, which is what keeps every blob reaching its goals.
- Guarantees each tick: no two blobs on one node, no two blobs swapping nodes, and no two blobs closer than `MinSep` at any moment of the tick.
- Why step 4: a walker that outranks a blob it can never push would wait behind it for ever, and so would everyone queued behind it. A new goal drops its priority to the bottom, so the blob in front can move off on its own *(design)*. On the city it is a rare backstop. The walk graph has no node where a blob stepping in from one side clashes with every way out (a *trap entry*, ruled out by `CheckGraph` rule 4; see [engine/PIBT.md](./engine/PIBT.md#liveness-blobs-keep-reaching-their-goals)). Over seeds 1–200 step 4 fired 5 times in all, and turning it off changes no run on seeds 1–40: every blob reached at least 15 goals in a 50-round run (mean 23.3). Before trap entries were ruled out, 72 city nodes had one and step 4 fired about 14 times per run; without it, 29 of 40 seeds had a blob reach fewer than 2 goals.

## Announcements

- 5 stories per run, at rounds 0, 10, 20, 30, 40 ([GAME LOOP.md](./GAME%20LOOP.md)).
- Each story has `claimed` (0–100) and `delivered` (0–100). See [#claim-scale](#claim-scale).
- On announce, every blob's `heard` and `sources` reset *(design)*. Old stories live on only in perception, interest and `credibility`.
- The company reaches directly: all 6 leaders, plus each other blob with probability 0.30 *(design)*. Leaders "share news from outlets" ([BLOBS.md](./BLOBS.md#special-traits)), [18]. Expect about 34 of 100 blobs.
- A direct hearing is `hear(b, c = claimed, tone = 50 + claimed/2, k = cred(b) × credibility)`. See [#influence](#influence).
- Content lives in `internal/sim/content/announcements.json`, loaded by `content.LoadAnnouncements()`. Company: Tallowick AI (fictional).
- The file has `"label": "SIMULATED"`. The UI must show this label wherever content appears.
- An option counts as honest when `|claimed − delivered| ≤ 5` *(design)*.

## Actions

A blob with `heard == none` idles: it has nothing to pass on *(design)*.
Otherwise, per round:

```
pActive = clamp(soc(b) + 0.40 * b.interest/100 + 0.20 * |b.perception - 50|/50, 0, 0.90)
if rng() >= pActive: idle
else if b.recluse:            post
else if b.age < 13:           talk
else if rng() < pPost(b.age): post
else:                         talk
```

| Socialness tag | `soc(b)` | Source |
|---|---|---|
| `quiet` | 0.10 | *(design)* |
| none | 0.20 | *(design)* |
| `chatty` | 0.40 | *(design)*, [13], [14] |

- Chance to share rises with interest, not perception [1], [2]. Weight 0.40 per 100 points of interest *(design)*.
- Blobs far from neutral talk more [30]. Weight 0.20 at perception 0 or 100 *(design)*.
- Cap 0.90 so nobody acts every round *(design)*.
- Range of `pActive`: 0.10 (quiet, interest 0, perception 50) to 0.90.

| Age | `pPost` | Source |
|---|---|---|
| 0–12 | 0 (never posts) | ([BLOBS.md](./BLOBS.md#age)), [35] |
| 13–17 | 0.50 | *(design)*, [36] |
| 18–64 | 0.30 | *(design)* |
| 65+ | 0.30 | *(design)* |

- Recluses always post, never talk in person ([BLOBS.md](./BLOBS.md#special-traits)).
- Elders post at the adult rate *(design)*. Their higher sharing of questionable news [8] comes from higher trust ([#trust](#trust)), not more posting.

## Partner choice

A talking blob `a` picks one partner `b` from all blobs except itself and recluses, with weight *(design)*:

```
w(a, b) = home(a,b) × hood(a,b) × shape(a,b)
```

| Factor | Same | Different | Source |
|---|---|---|---|
| `home` (same home, incl. family) | 4.0 | 1.0 | *(design)*, [4] |
| `hood` (same neighbourhood) | 2.0 | 1.0 | *(design)*, [20] |
| `shape` (same shape) | 1.5 | 1.0 | *(design)*, [20] |

- Range of `w`: 1.0–12.0.
- Partner choice is who you meet. How much you believe them is [#trust](#trust); keep them separate *(design)*.
- Weight is the same for every shape, so contact patterns do not make a shape more exposed *(design)*.
- Mixed two-person homes and mixed neighbourhoods carry news across shapes [28].
- Recluses are never chosen as partners ([BLOBS.md](./BLOBS.md#special-traits)). Under-13s can be chosen.

## Trust

`trust(listener l, speaker s)`, range 0.75–3.0. Set by the listener's shape *(design within cited directions)*:

| Listener shape | Trust high | High | Everyone else | Source |
|---|---|---|---|---|
| Square | Same shape | 2.0 | 0.80 | [19], [21] |
| Circle | Everyone | 1.0 | 1.0 | [19] |
| Triangle | Age within ±10 years | 2.0 | 0.75 | [20] |
| Star | Own shape's leader | 3.0 | 0.80 (1.0 for own shape) | [18] |
| Tear | Same neighbourhood | 2.0 | 0.75 | [20] |
| Capsule | Same family | 3.0 | 0.80 | [22] |

Modifiers, applied after the table, then `clamp(t, 0.75, 3.0)`:
- Child listener (0–17) hearing their own parent: × 2.0 [4], [5].
- Elder listener (65+): × 1.2 [6]. This is trust, not credulity ([BLOBS.md](./BLOBS.md#age)).
- Company as speaker (`-1`): trust 1.0 for everyone *(design)*.
- "Everyone else" values are chosen so each shape's town-average trust is near 1.0 *(design)*. Shape sets **who** is trusted, not **how much**. Follow-up (no issue yet): a calibration check should report mean trust per shape and flag any shape outside 0.9–1.1.

## Influence

One hearing. Listener `l`, speaker `s`, claim strength `c` (0–100), tone `T` (0–100):

```
k     = cred(l) × pers(s) × trust(l, s) × channel × repeat(l, s) × credibility
alpha = min(0.50, 0.08 × k)
l.interest   += alpha × (c - l.interest)
l.perception += alpha × (T - l.perception)
l.heard  = c                                   if l.heard == none
         = (l.heard × n + c) / (n + 1)         else, n = len(l.sources)
l.sources.add(s)
```

- Scores move a fraction `alpha` toward a target, so they never overshoot 0 or 100 *(design)*.
- Interest moves toward what was heard: a bolder claim pulls interest higher [25] *(design)*.
- Perception moves toward the tone. Tone of a retelling is `T = 0.5 × s.perception + 0.5 × (50 + c/2)` *(design)*: half the claim, half the teller's own opinion [27]. A claim of 0 gives 50 from the claim half; a claim of 100 gives 100.
- `alpha` range: 0 to 0.50. Typical (all average, trust 1): 0.08.
- Cap 0.50: no single hearing moves a blob more than halfway *(design)*.

| Credulity tag | `cred(l)` | Source |
|---|---|---|
| `skeptic` | 0.6 | *(design)*, [10], [11] |
| none | 1.0 | |
| `gullible` | 1.5 | *(design)*, [10], [11] |

| Persuasiveness tag | `pers(s)` | Source |
|---|---|---|
| `unconvincing` | 0.6 | *(design)*, [12] |
| none | 1.0 | |
| `charismatic` | 1.5 | *(design)*, [12] |
| company (`-1`) | 1.0 | *(design)* |

| Channel | `channel` | Source |
|---|---|---|
| In person | 1.0 | *(design)* |
| Social media post | 0.5 | *(design)* |
| Company announcement | 1.0 | *(design)* |

### Repeat

```
repeat(l, s) = 0.5                                          if s in l.sources
             = 1.0 + 0.25 × min(len(l.sources) - 1, 4)      if len(l.sources) >= 1
             = 1.0                                          if l.sources is empty
```

- Hearing again counts [23]. A new source counts more than the same source twice [24].
- Same source again: × 0.5 *(design)*.
- New source: +0.25 per distinct earlier source beyond the first, up to × 2.0 at 5+ *(design)*.
- Range: 0.5–2.0.
- Note: `len(l.sources) - 1` uses the count **before** adding `s`.

## Drift

Each retelling changes the claim strength the next blob hears. Deterministic, so the stub brain can apply it *(design)*:

```
c_told = clamp(s.heard + sharpen + 0.10 × (s.perception - 50), 0, 100)
```

| Channel | `sharpen` (points per retelling) | Source |
|---|---|---|
| In person | +3 | *(design)*, [27] |
| Social media post | +5 | *(design)*, [25] |

- Striking parts grow on retelling [27]; alarming or surprising versions spread further online [25]. Hence a positive `sharpen`.
- The teller bends the story to fit their view [27]: ±5 points at perception 0 or 100.
- Range of one step: −2 to +10 points (in person), 0 to +10 (post), before clamping.
- Effect: after a few hops, many blobs have heard a stronger claim than the company made. That widens the shipping gap ([#shipping](#shipping)).
- A real model (`BRAIN=anthropic`) may rewrite the text, but must still return `c_told` from this formula *(design)*. The number drives the sim; the text is flavour.

## Social media

A post by `s` reaches 8 readers *(design)*:

- Readers: 8 distinct blobs drawn uniformly from everyone except `s`, including recluses and under-13s *(design)*.
- Each reader gets `hear(reader, c_told, T, k)` with `channel = 0.5`.
- Range: exactly 8 readers per post. About 8% of the town.
- Uniform reach is a simplification *(design)*. No feed algorithm.
- Posts reach across shapes and neighbourhoods; in-person talk mostly does not [28].

## Decay

- Every round, after all actions: `interest += 0.03 × (10 - interest)` *(design)*.
- Interest drifts toward 10 with a half-life of about 23 rounds. Keeps interest from sitting at 100 *(design)*.
- Perception does not decay. A debunked claim never fully wears off [32].

## Claim scale

Each announcement has two numbers, set in content data (issue #13):

| Value | Meaning |
|---|---|
| 0–20 | Minor fix, routine update |
| 21–40 | Modest improvement |
| 41–60 | Solid new feature |
| 61–80 | Major feature, big promise |
| 81–100 | Revolutionary, "changes everything" |

- `claimed` is what the company says. `delivered` is what actually ships *(design)*.
- Content should offer each round at least one honest option (`claimed ≈ delivered`) and one bold option (`claimed − delivered ≥ 20`) *(design)*.
- Content should keep `delivered ≤ 85` *(design)*, so a perfect score is not reachable by one honest story.

## Shipping

Each story ships 8 rounds after it is announced: rounds 8, 18, 28, 38, 48 *(design)*. This gives 2 rounds of reaction before the next story.

```
for b in blobs:
    h, w = (b.heard, 1.0) if b.heard != none else (claimed, 0.5)
    gap  = delivered - h
    loss = 2.0 if gap < 0 else 1.0
    b.perception = clamp(b.perception + w × 0.25 × loss × gap, 0, 100)
    b.interest   = clamp(b.interest + 0.30 × (delivered - b.interest), 0, 100)
if claimed - delivered > 15: broken += 1
credibility = max(0.30, 0.80 ^ broken)
```

- Perception moves by the gap between what the blob **heard** and what shipped [29]. Drift makes this gap bigger than the company's own gap.
- 0.25 perception points per point of gap *(design)*. Range of one ship: −50 to +25 points before clamping.
- Losses count 2× gains [31]. The factor 2.0 is *(design)*; [31] supports an asymmetry, not this exact value.
- Blobs who never heard the story see the product anyway, at half weight, judged against the company's own claim *(design)*.
- Interest moves 30% of the way to `delivered` *(design)*: people see what it really is.
- A broken promise is `claimed − delivered > 15` *(design)*.
- Each broken promise multiplies `credibility` by 0.80, floor 0.30 [33], [34]. `credibility` scales **every** hearing in [#influence](#influence), so later claims land worse. It never recovers in a run [32].
- Range of `credibility`: 1.00 (no broken promises) to 0.33 (5 broken).

## Sanity check

A Python prototype of the rules above (not the Go engine) was run on 5 seeds (1–5), stub drift only. Town averages, mean of 5 seeds:

| Strategy (all 5 stories) | Round 5 P / I | Round 10 P / I | Round 50 P / I |
|---|---|---|---|
| Honest: claimed 50, delivered 50 | 53 / 26 | 53 / 41 | 62 / 56 |
| Bold: claimed 90, delivered 50 | 56 / 35 | 44 / 56 | 22 / 61 |
| Modest: claimed 40, delivered 55 | 53 / 24 | 57 / 38 | 72 / 54 |
| Big and true: claimed 90, delivered 90 | 56 / 35 | 63 / 67 | 90 / 86 |

- Bold raises interest faster (35 vs 26 at round 5) and is liked at first, then loses perception at each ship.
- Under-promising wins perception; bold wins interest. Matches [BLOBS.md](./BLOBS.md#interactions).
- No saturation: in the harshest case (bold, 5 broken promises) at most 1 of 100 blobs ends at perception ≤ 1, and no blob has interest ≤ 1 or ≥ 99.
- These are design checks, not calibration. They were checked on a Python prototype only; the Go engine should reproduce them with fixed seeds (follow-up, no issue yet) before any number here is called calibrated.

## Worked example

Round 3. Speaker Ada: average socialness, `charismatic`, perception 60, heard 90 from a bold story. Listener Bo: Square, `gullible`, perception 50, interest 20, same shape as Ada, has heard from 1 other blob, `heard = 88`. `credibility = 1.0`.

1. Ada has interest 40. `pActive = 0.20 + 0.40 × 0.40 + 0.20 × 10/50 = 0.40`. Roll 0.31 < 0.40, acts. Adult, roll 0.70 ≥ 0.30 → talks.
2. Drift: `c_told = 90 + 3 + 0.10 × 10 = 94`.
3. Tone: `T = 0.5 × 60 + 0.5 × (50 + 47) = 78.5`.
4. `k = 1.5 (gullible) × 1.5 (charismatic) × 2.0 (Square, same shape) × 1.0 × 1.0 (repeat, 1 earlier source) × 1.0 = 4.5`.
5. `alpha = min(0.50, 0.08 × 4.5) = 0.36`.
6. Bo: interest `20 + 0.36 × 74 = 46.6`; perception `50 + 0.36 × 28.5 = 60.3`; heard `(88 × 1 + 94) / 2 = 91`.
7. Round 8, the product ships with `delivered = 50`. Bo: `gap = 50 − 91 = −41`, loss 2.0, perception `60.3 − 0.25 × 2 × 41 = 39.8`. Interest `46.6 + 0.30 × 3.4 = 47.6` (before decay).
8. `90 − 50 = 40 > 15`: `broken = 1`, `credibility = 0.80` for the rest of the run.

Bo ends the story more interested but thinking less of the company than when he started.

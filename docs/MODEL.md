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

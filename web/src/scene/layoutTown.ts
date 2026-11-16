// Pure, deterministic town layout: plain data in world units (an adult blob is ~1 tall).
// No three.js, DOM, Math.random or clock, so the same counts always give the same town.
//
// Neighbourhoods sit in a ring around a central square. Each one is a cul-de-sac: a spoke
// path runs out from the square to a loop street, and homes stand around the outside of
// the loop facing it. Big neighbourhoods add further loops and rings of homes outward.

export const HOME_WIDTH = 2.8; // along the street
export const HOME_DEPTH = 2.4; // front (door) to back
// Headroom over the tallest roof, chimney or tree the scene builds, for framing and shadows.
export const TOWN_HEIGHT = 4.5;

const HOME_GAP = 1.0; // clear ground between the front corners of neighbouring homes
const SETBACK = 0.6; // front of a home to the edge of its street
const STREET_WIDTH = 1.6;
const SPOKE_WIDTH = 2.4;
const SPOKE_CLEARANCE = 0.5; // spoke edge to the nearest home
const BACK_GAP = 1.0; // backs of one ring of homes to the next street out
const EDGE_MARGIN = 1.2; // neighbourhood ground beyond its outermost homes
const NEIGHBOURHOOD_GAP = 3;
const SPOKE_MIN_LENGTH = 3; // open path between the square and the nearest homes' ground
const MIN_RING_RADIUS = 6; // keeps a lawn inside even a tiny loop
const FIRST_RING_MAX = 12; // past this, add rings rather than one huge loop
const LOOSEST_STEP = 1.25; // a small ring may spread its homes this much past tight

// The square holds everyone at once: about 2 blobs per home, ~3 square units each.
const SQUARE_AREA_PER_HOME = 6;
const SQUARE_MIN_RADIUS = 7;
const FOUNTAIN_RADIUS = 1.9;

// Trees: one on each neighbourhood's green, and a seeded scatter over the open fields.
export const TREE_RADIUS = 1.1; // canopy radius of a size-1 tree
const GREEN_TREE_SIZE = 1.3;
const TREE_DENSITY = 0.006; // scattered trees per square unit of field
const TREE_BELT = 14; // width of the field around the town that gets trees
const TREE_GAP = 0.6; // clear ground between neighbouring canopies
const SQUARE_VERGE = 2; // open ground kept around the square
const SPOKE_VERGE = 1; // open ground kept along each spoke

// Organic jitter. Homes only move away from their street, so setbacks never shrink.
const JITTER_TURN = 0.05; // radians
const JITTER_PUSH = 0.35;
// Furthest a home corner can move when the home turns by JITTER_TURN.
const TURN_SLACK = Math.hypot(HOME_WIDTH / 2, HOME_DEPTH / 2) * JITTER_TURN;

export interface TownHome {
  index: number;
  neighbourhood: number;
  x: number;
  z: number;
  /** Turns the home's front (local +z, the door side) to face its street. */
  rotationY: number;
}

export interface TownNeighbourhood {
  index: number;
  x: number;
  z: number;
  /** Radius of the neighbourhood's ground; all its homes and loop streets are inside. */
  radius: number;
  homeCount: number;
}

export interface TownSquare {
  x: number;
  z: number;
  radius: number;
  /** The fountain at the centre; blobs gather between it and the edge. */
  fountainRadius: number;
}

export type TownPath =
  | { kind: "line"; x1: number; z1: number; x2: number; z2: number; width: number }
  | { kind: "ring"; x: number; z: number; radius: number; width: number };

export interface TownTree {
  x: number;
  z: number;
  /** Scales a canopy of TREE_RADIUS. */
  size: number;
}

type Line = Extract<TownPath, { kind: "line" }>;

export interface TownBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TownLayout {
  /** homes[i] belongs to neighbourhood i % neighbourhoodCount (dealt round-robin). */
  homes: TownHome[];
  neighbourhoods: TownNeighbourhood[];
  square: TownSquare;
  paths: TownPath[];
  /** Trees may stand in the fields outside the bounds. */
  trees: TownTree[];
  /** The town itself: the square and every neighbourhood. */
  bounds: TownBounds;
}

interface Ring {
  radius: number; // of home centres, before jitter
  count: number;
}

export function layoutTown(homeCount: number, neighbourhoodCount: number): TownLayout {
  if (!Number.isInteger(homeCount) || homeCount < 0) {
    throw new RangeError(`homeCount must be a whole number >= 0, got ${homeCount}`);
  }
  if (!Number.isInteger(neighbourhoodCount) || neighbourhoodCount < 1) {
    throw new RangeError(
      `neighbourhoodCount must be a whole number >= 1, got ${neighbourhoodCount}`,
    );
  }

  const n = neighbourhoodCount;
  const sizes = Array.from({ length: n }, (_, k) => Math.floor((homeCount + n - 1 - k) / n));
  const plans = sizes.map(planRings);
  const radii = plans.map((rings) => outerRadius(rings[rings.length - 1].radius) + EDGE_MARGIN);
  const widest = Math.max(...radii);

  const squareRadius = Math.max(
    SQUARE_MIN_RADIUS,
    Math.sqrt((homeCount * SQUARE_AREA_PER_HOME) / Math.PI + FOUNTAIN_RADIUS ** 2),
  );
  // One distance for every neighbourhood keeps the town symmetric. Far enough to leave an
  // open spoke past the square and, with two or more, a gap between neighbours.
  let distance = squareRadius + SPOKE_MIN_LENGTH + widest;
  if (n > 1)
    distance = Math.max(distance, (widest + NEIGHBOURHOOD_GAP / 2) / Math.sin(Math.PI / n));

  const random = mulberry32(Math.imul(homeCount, 0x9e3779b1) ^ Math.imul(n, 0x85ebca6b));
  const homes: TownHome[] = [];
  const neighbourhoods: TownNeighbourhood[] = [];
  const paths: TownPath[] = [];
  const spokes: Line[] = [];
  // Slot j of neighbourhood k holds home j * n + k; filled below in neighbourhood order.
  const slots: { x: number; z: number; rotationY: number }[][] = [];

  plans.forEach((rings, k) => {
    // Neighbourhood 0 sits at the far side (-z) so the default view looks in through a gap.
    const angle = -Math.PI / 2 + (2 * Math.PI * k) / n;
    const out = { x: Math.cos(angle), z: Math.sin(angle) };
    const cx = out.x * distance;
    const cz = out.z * distance;
    neighbourhoods.push({ index: k, x: cx, z: cz, radius: radii[k], homeCount: sizes[k] });

    const firstStreet = streetRadius(rings[0].radius);
    const spoke: Line = {
      kind: "line",
      x1: out.x * (squareRadius - 1),
      z1: out.z * (squareRadius - 1),
      x2: cx - out.x * firstStreet,
      z2: cz - out.z * firstStreet,
      width: SPOKE_WIDTH,
    };
    spokes.push(spoke);
    paths.push(spoke);

    const placed: (typeof slots)[number] = [];
    for (const ring of rings) {
      paths.push({
        kind: "ring",
        x: cx,
        z: cz,
        radius: streetRadius(ring.radius),
        width: STREET_WIDTH,
      });
      const free = 2 * Math.PI - 2 * spokeHalfGap(ring.radius);
      const step =
        ring.count > 1
          ? Math.min(homeStep(ring.radius) * LOOSEST_STEP, free / (ring.count - 1))
          : 0;
      for (let j = 0; j < ring.count; j++) {
        // Homes wrap around the far side of the loop, leaving the spoke side open.
        const a = angle + (j - (ring.count - 1) / 2) * step;
        const r = ring.radius + random() * JITTER_PUSH;
        const turn = (random() * 2 - 1) * JITTER_TURN;
        placed.push({
          x: cx + Math.cos(a) * r,
          z: cz + Math.sin(a) * r,
          rotationY: Math.atan2(-Math.cos(a), -Math.sin(a)) + turn,
        });
      }
    }
    slots.push(placed);
  });

  for (let i = 0; i < homeCount; i++) {
    const k = i % n;
    homes.push({ index: i, neighbourhood: k, ...slots[k][Math.floor(i / n)] });
  }

  const square: TownSquare = { x: 0, z: 0, radius: squareRadius, fountainRadius: FOUNTAIN_RADIUS };
  const discs = [square, ...neighbourhoods];
  const bounds: TownBounds = {
    minX: Math.min(...discs.map((d) => d.x - d.radius)),
    maxX: Math.max(...discs.map((d) => d.x + d.radius)),
    minZ: Math.min(...discs.map((d) => d.z - d.radius)),
    maxZ: Math.max(...discs.map((d) => d.z + d.radius)),
  };

  // Planted after the homes, so adding trees never moves a home.
  const trees = plantTrees(random, square, neighbourhoods, spokes, distance + widest + TREE_BELT);

  return { homes, neighbourhoods, square, paths, trees, bounds };
}

// A tree on each green, then random spots in the fields, kept only where they clear the
// square, every neighbourhood, every spoke and the trees already planted.
function plantTrees(
  random: () => number,
  square: TownSquare,
  neighbourhoods: TownNeighbourhood[],
  spokes: Line[],
  outer: number,
): TownTree[] {
  const trees: TownTree[] = neighbourhoods.map((n) => ({ x: n.x, z: n.z, size: GREEN_TREE_SIZE }));
  const inner = square.radius + SQUARE_VERGE;
  const wanted = trees.length + Math.round(TREE_DENSITY * Math.PI * (outer ** 2 - inner ** 2));
  for (let tries = 0; tries < wanted * 30 && trees.length < wanted; tries++) {
    const angle = random() * 2 * Math.PI;
    const r = Math.sqrt(inner ** 2 + random() * (outer ** 2 - inner ** 2)); // even by area
    const tree = { x: Math.cos(angle) * r, z: Math.sin(angle) * r, size: 0.7 + random() * 0.5 };
    const reach = TREE_RADIUS * tree.size;
    const clear =
      r >= inner + reach &&
      neighbourhoods.every((n) => Math.hypot(tree.x - n.x, tree.z - n.z) >= n.radius + reach) &&
      spokes.every((s) => distanceToLine(tree, s) >= s.width / 2 + SPOKE_VERGE + reach) &&
      trees.every(
        (t) => Math.hypot(tree.x - t.x, tree.z - t.z) >= reach + TREE_RADIUS * t.size + TREE_GAP,
      );
    if (clear) trees.push(tree);
  }
  return trees;
}

function distanceToLine(p: { x: number; z: number }, l: Line): number {
  const dx = l.x2 - l.x1;
  const dz = l.z2 - l.z1;
  const t = Math.max(0, Math.min(1, ((p.x - l.x1) * dx + (p.z - l.z1) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - (l.x1 + t * dx), p.z - (l.z1 + t * dz));
}

// Rings of homes for one neighbourhood, innermost first.
function planRings(count: number): Ring[] {
  const first = Math.min(count, FIRST_RING_MAX);
  let radius = MIN_RING_RADIUS;
  // Smallest loop (to 0.05) that fits the first ring; plain search keeps it obviously exact.
  for (let i = 1; capacity(radius) < first; i++) radius = MIN_RING_RADIUS + i * 0.05;

  const rings: Ring[] = [];
  let left = count;
  do {
    const take = Math.min(left, capacity(radius));
    rings.push({ radius, count: take });
    left -= take;
    // The next street runs just past the backs of this ring.
    radius = outerRadius(radius) + BACK_GAP + STREET_WIDTH + SETBACK + HOME_DEPTH / 2;
  } while (left > 0);
  return rings;
}

function capacity(radius: number): number {
  return 1 + Math.floor((2 * Math.PI - 2 * spokeHalfGap(radius)) / homeStep(radius));
}

// Centre of the loop street in front of a ring of homes.
function streetRadius(radius: number): number {
  return radius - HOME_DEPTH / 2 - SETBACK - STREET_WIDTH / 2;
}

// Furthest a home in this ring can reach from the neighbourhood centre.
function outerRadius(radius: number): number {
  return Math.hypot(radius + JITTER_PUSH + HOME_DEPTH / 2, HOME_WIDTH / 2) + TURN_SLACK;
}

// Angle between neighbouring homes so their front corners, the closest points of two homes
// facing the same centre, stay HOME_GAP apart.
function homeStep(radius: number): number {
  const front = radius - HOME_DEPTH / 2;
  const corner = Math.hypot(front, HOME_WIDTH / 2);
  const gap = HOME_GAP + 2 * TURN_SLACK;
  return 2 * (Math.atan2(HOME_WIDTH / 2, front) + Math.asin(gap / (2 * corner)));
}

// Half the angle left open where the spoke crosses the ring, so the front corners of the
// two homes beside it stay clear of the spoke.
function spokeHalfGap(radius: number): number {
  const front = radius - HOME_DEPTH / 2;
  const corner = Math.hypot(front, HOME_WIDTH / 2);
  const reach = SPOKE_WIDTH / 2 + SPOKE_CLEARANCE + TURN_SLACK;
  return Math.atan2(HOME_WIDTH / 2, front) + Math.asin(reach / corner);
}

// Tiny seeded PRNG (mulberry32): deterministic jitter without a dependency.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

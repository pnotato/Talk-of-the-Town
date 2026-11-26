// Pure, deterministic harbour layout: plain data in world units (an adult blob is ~1 tall).
// No three.js, DOM, Math.random or clock, so the same counts always give the same harbour.
//
// A lakeside harbour on a festival day. The bay lies to the north, so the default camera, which
// looks north from the south, looks over the town and out across the water. A timber boardwalk
// runs along the sea wall. A pier leaves it for a broad pier head with a ferris wheel at its far
// end. Behind the boardwalk, the festival green has a carousel under a canopy of festoon lights,
// and market stalls along its far side. Clapboard homes line Front Street and Hill Street behind
// it, and cottages sit among the pines on the two shores. A lighthouse stands on a rock at the
// end of the east breakwater, the news screen floats on a barge in the bay, and sailboats ride
// at anchor.
//
// Blobs walk and stand on the green, the boardwalk, the pier and the pier head (the gathering's
// areas): four rectangles, each touching the next, so the walk map stays axis-aligned.

import { type Box, distanceToBox, type Point, seededRandom, type Solid } from "./mapLayout.ts";

// docs/MODEL.md: 53 homes dealt round-robin into 5 neighbourhoods.
export const HARBOUR_HOMES = 53;
export const HARBOUR_NEIGHBOURHOODS = 5;

/** Blobs' feet and the walkable grid: just above the decks' planks and the green's lawn. */
export const HARBOUR_SURFACE = 0.05;
/** Still water; the waves rise and fall about it. */
export const WATER_LEVEL = -1.1;
/** How far a deck runs past its walkable edge, to the railing over the water. */
export const DECK_OVERHANG = 0.6;
/** A deck's boards and joists, below its top. */
export const DECK_THICKNESS = 0.4;

// Trees, at size 1, as HarbourTrees draws them.
export const PINE_RADIUS = 1.5;
export const PINE_HEIGHT = 6.4;
export const MAPLE_RADIUS = 1.6;
export const MAPLE_HEIGHT = 4.8;

/** Top of a festoon pole, where its string of lights hangs from. */
export const POLE_HEIGHT = 4.2;
/** Top of a lamp post's lantern on the boardwalk and the pier. */
export const LAMP_HEIGHT = 3.1;
export const STALL_HEIGHT = 2.9;
/** A home's chimney stands this far above its ridge. */
export const CHIMNEY = 0.55;

/** An axis-aligned rectangle: `width` along x, `depth` along z. */
export interface HarbourRect extends Point {
  width: number;
  depth: number;
}

/** The four walkable rectangles: the main gathering place first. */
export const GREEN: HarbourRect = { x: 0, z: 18, width: 60, depth: 20 };
export const BOARDWALK: HarbourRect = { x: 0, z: 4, width: 84, depth: 8 };
export const PIER: HarbourRect = { x: 0, z: -11, width: 7, depth: 22 };
export const PIERHEAD: HarbourRect = { x: 0, z: -29, width: 26, depth: 14 };

/** Where the sea wall meets the boardwalk: the coast runs straight along z = 0 between these. */
export const SEA_WALL = { from: -46, to: 46 };

const CAROUSEL = { x: 0, z: 18, radius: 3.6, height: 5.4 };
// The carousel's fence: blobs keep their reach from this.
const CAROUSEL_FENCE = 0.4;
const WHEEL = { radius: 9.5, hub: 11.4, gondolas: 16 };
const WHEEL_PLATFORM: HarbourRect = { x: 0, z: -39.8, width: 12, depth: 6.4 };
const LIGHTHOUSE = { x: 60, z: -38, radius: 1.5, height: 14.5, island: 5.5 };
const BREAKWATER = { from: { x: 55, z: -4 }, to: { x: 59, z: -33 }, width: 3 };
const SCREEN = { width: 11, height: 6.1875, lift: 1.4, deck: 0.5 }; // 16:9
const BARGE = { x: -24, z: -17, width: 13.5, depth: 4.6, rotationY: 0.2 };

const BENCH = { width: 1.8, depth: 0.7 };
// Granite outcrops of the Shield on the shores, each with a pair of Muskoka chairs facing the bay.
const OUTCROPS = [
  { x: -66, z: -9, size: 3.2, facing: 0.9 },
  { x: -73, z: -22, size: 2.6, facing: 1.1 },
  { x: -79, z: -36, size: 2.9, facing: 1.4 },
  { x: 67, z: -5, size: 2.6, facing: -0.9 },
];
const STALL = { width: 4.2, depth: 2.4 };

const LANES: HarbourRect[] = [
  { x: 0, z: 33.5, width: 116, depth: 3.8 }, // Front Street
  { x: 0, z: 45.2, width: 64, depth: 3.2 }, // Hill Street
  { x: 0, z: 39.35, width: 3.2, depth: 7.9 }, // the lane up the hill between them
];

// Homes: a street-front width and depth before their seeded variety.
const HOME_WIDTH = 3.4;
const HOME_DEPTH = 3.6;
const STOREY = 1.3;
const ROW_FRONT = 37.3; // Front Street's houses: their fronts, facing the green
const HILL_FRONT = 48.6; // Hill Street's
const ROW_PITCH = 4.6;
const HILL_PITCH = 5.6;

export interface HarbourHome extends Box {
  index: number;
  neighbourhood: number;
  /** Eaves height. */
  wallHeight: number;
  roofHeight: number;
  /** "side": the ridge runs along the front; "front": the gable faces it. */
  roof: "side" | "front";
  /** Indexes into the palettes HarbourVillage paints with. */
  body: number;
  roofColour: number;
  door: number;
}

export interface HarbourNeighbourhood {
  index: number;
  name: string;
  homeCount: number;
  centre: Point;
}

export type HarbourTreeKind = "pine" | "maple";

export interface HarbourTree extends Point {
  kind: HarbourTreeKind;
  size: number;
}

export type HarbourPropKind = "bench" | "planter" | "pole" | "bell" | "telescope" | "cart";

/** Furniture on the walkable decks and lawn. Its front faces local +z. */
export interface HarbourProp extends Box {
  kind: HarbourPropKind;
}

export interface HarbourStall extends Box {
  /** Index into the awning stripes HarbourFestival paints with. */
  awning: number;
}

/** A picnic table with its benches, on the lawns either side of the green. */
export type HarbourPicnic = Box;

export interface HarbourChair extends Point {
  rotationY: number;
  colour: number;
}

export interface HarbourRock extends Point {
  size: number;
  /** How far it sinks into the water or the ground, as a share of its size. */
  sink: number;
  turn: number;
}

export type HarbourBoatKind = "sail" | "dinghy" | "fishing";

export interface HarbourBoat extends Point {
  kind: HarbourBoatKind;
  /** Which way the bow points (three.js rotation.y of local +z). */
  heading: number;
  length: number;
  colour: number;
  /** A sailboat's lap of the bay when clicked: a circle through its mooring. */
  loop?: { x: number; z: number; radius: number };
}

/** A string of festoon lights from one point to another, sagging in the middle. */
export interface HarbourFestoon {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  sag: number;
}

export interface HarbourKite extends Point {
  height: number;
  colour: number;
  /** Where its string is staked. */
  anchor: Point;
}

export interface HarbourLayout {
  green: HarbourRect;
  boardwalk: HarbourRect;
  pier: HarbourRect;
  pierhead: HarbourRect;
  /** The coast from west to east, land to its south; x only ever increases. */
  coast: Point[];
  /** Gravel lanes on the land: Front Street, Hill Street and the lane between them. */
  lanes: HarbourRect[];
  homes: HarbourHome[];
  neighbourhoods: HarbourNeighbourhood[];
  trees: HarbourTree[];
  props: HarbourProp[];
  stalls: HarbourStall[];
  picnics: HarbourPicnic[];
  chairs: HarbourChair[];
  rocks: HarbourRock[];
  boats: HarbourBoat[];
  festoons: HarbourFestoon[];
  kites: HarbourKite[];
  carousel: { x: number; z: number; radius: number; height: number };
  wheel: {
    x: number;
    z: number;
    hub: number;
    radius: number;
    gondolas: number;
    platform: HarbourRect;
  };
  lighthouse: { x: number; z: number; radius: number; height: number; island: number };
  breakwater: { from: Point; to: Point; width: number };
  /** The floating news screen: its barge, and its panel in the barge's own space. */
  screen: {
    barge: Box;
    panel: { width: number; height: number; y: number };
    deck: number;
  };
  /** Where the camera's target may roam. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Tall things the camera keeps out of, with the height of their tops. */
  solids: Solid[];
  height: number;
}

const rectBox = (r: HarbourRect): Box => ({ ...r, rotationY: 0 });

function insideRect(p: Point, r: HarbourRect, margin = 0): boolean {
  return Math.abs(p.x - r.x) <= r.width / 2 + margin && Math.abs(p.z - r.z) <= r.depth / 2 + margin;
}

// The coast's hand-drawn turns, west to east. Between them, the shore wanders a little.
const COAST_WEST: Point[] = [
  { x: -5000, z: -100 },
  { x: -420, z: -96 },
  { x: -150, z: -92 },
  { x: -108, z: -84 },
  { x: -93, z: -71 },
  { x: -85, z: -55 },
  { x: -79, z: -41 },
  { x: -72, z: -28 },
  { x: -64, z: -17 },
  { x: -56, z: -9 },
  { x: -50, z: -3.5 },
];
const COAST_EAST: Point[] = [
  { x: 50, z: -2.5 },
  { x: 55, z: -5 },
  { x: 62, z: -6.5 },
  { x: 70, z: -12 },
  { x: 78, z: -24 },
  { x: 88, z: -44 },
  { x: 102, z: -62 },
  { x: 132, z: -80 },
  { x: 420, z: -92 },
  { x: 5000, z: -100 },
];
// Between neighbouring hand-drawn points closer than this, the shore gets a few wandering
// points; the long runs out to the horizon stay straight.
const WANDER_SPAN = 60;
const WANDER = 0.9;

function wander(points: Point[], random: () => number): Point[] {
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (b.x - a.x < WANDER_SPAN) {
      const steps = Math.max(2, Math.round((b.x - a.x) / 2.5));
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        out.push({
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t + (random() - 0.5) * WANDER,
        });
      }
    }
    out.push(b);
  }
  return out;
}

/** The coast's z at x: the land lies at larger z. */
export function coastAt(coast: Point[], x: number): number {
  if (x <= coast[0].x) return coast[0].z;
  for (let i = 1; i < coast.length; i++) {
    const a = coast[i - 1];
    const b = coast[i];
    if (x <= b.x) return a.z + ((b.z - a.z) * (x - a.x)) / (b.x - a.x);
  }
  return coast[coast.length - 1].z;
}

/** Whether a point is on land, at least `margin` in from the shore. */
export function onLand(coast: Point[], p: Point, margin = 0): boolean {
  return p.z >= coastAt(coast, p.x) + margin;
}

function buildCoast(random: () => number): Point[] {
  return [
    ...wander(COAST_WEST, random),
    { x: SEA_WALL.from, z: 0 },
    { x: SEA_WALL.to, z: 0 },
    ...wander(COAST_EAST, random),
  ];
}

function walkObstacleProps(): HarbourProp[] {
  const props: HarbourProp[] = [];
  const bench = (x: number, z: number, rotationY: number): HarbourProp => ({
    kind: "bench",
    x,
    z,
    rotationY,
    ...BENCH,
  });
  // Benches along the boardwalk's water edge, facing the bay; none in the pier's mouth.
  for (const x of [-37, -27, -17, 17, 27, 37]) props.push(bench(x, 1.15, Math.PI));
  // Planters of flowers at the boardwalk's ends.
  for (const x of [-39.5, 39.5]) {
    props.push({ kind: "planter", x, z: 6.5, width: 2.6, depth: 1.4, rotationY: 0 });
  }
  // The pier head: benches facing the ferris wheel, the harbour bell, two telescopes on the
  // corners looking out to sea, and an ice cream cart.
  for (const x of [-9, 9]) props.push(bench(x, -34.9, Math.PI));
  props.push({ kind: "bell", x: -11.4, z: -25.2, width: 1.2, depth: 1.2, rotationY: 0 });
  props.push({ kind: "telescope", x: -11.8, z: -34.8, width: 0.6, depth: 0.6, rotationY: Math.PI });
  props.push({ kind: "telescope", x: 11.8, z: -34.8, width: 0.6, depth: 0.6, rotationY: Math.PI });
  props.push({ kind: "cart", x: 10.8, z: -25.4, width: 2.2, depth: 1.2, rotationY: 0 });
  // Festoon poles round the green, an ellipse about the carousel that holds up the canopy
  // of lights.
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    props.push({
      kind: "pole",
      x: Math.round(19.5 * Math.cos(a) * 100) / 100,
      z: Math.round((CAROUSEL.z + 7.4 * Math.sin(a)) * 100) / 100,
      width: 0.4,
      depth: 0.4,
      rotationY: 0,
    });
  }
  return props;
}

// The green's four maples, framing the carousel from its corners.
const GREEN_MAPLES: HarbourTree[] = [
  { kind: "maple", x: -25.5, z: 12.5, size: 1.05 },
  { kind: "maple", x: 25.5, z: 12.5, size: 1.1 },
  { kind: "maple", x: -25.5, z: 23.8, size: 1.15 },
  { kind: "maple", x: 25.5, z: 23.8, size: 1 },
];

function festoons(props: HarbourProp[]): HarbourFestoon[] {
  const top = { x: CAROUSEL.x, y: CAROUSEL.height + 0.5, z: CAROUSEL.z };
  const out: HarbourFestoon[] = props
    .filter((p) => p.kind === "pole")
    .map((p) => ({ from: top, to: { x: p.x, y: POLE_HEIGHT, z: p.z }, sag: 0.9 }));
  // Swags between the lamp posts along the boardwalk's railing and down both sides of the pier.
  const lamps = boardwalkLamps();
  for (let i = 1; i < lamps.length; i++) {
    const a = lamps[i - 1];
    const b = lamps[i];
    if (b.x - a.x > 12) continue; // the pier's mouth
    out.push({
      from: { x: a.x, y: LAMP_HEIGHT - 0.2, z: a.z },
      to: { x: b.x, y: LAMP_HEIGHT - 0.2, z: b.z },
      sag: 0.55,
    });
  }
  for (const side of [-1, 1]) {
    const posts = pierLamps().filter((p) => Math.sign(p.x) === side);
    for (let i = 1; i < posts.length; i++) {
      out.push({
        from: { x: posts[i - 1].x, y: LAMP_HEIGHT - 0.2, z: posts[i - 1].z },
        to: { x: posts[i].x, y: LAMP_HEIGHT - 0.2, z: posts[i].z },
        sag: 0.5,
      });
    }
  }
  return out;
}

/** Lamp posts along the boardwalk's railing, just past its walkable edge over the water. */
export function boardwalkLamps(): Point[] {
  const out: Point[] = [];
  for (let x = -40; x <= 40; x += 8) {
    if (Math.abs(x) < 6) continue; // the pier leaves here
    out.push({ x, z: -DECK_OVERHANG * 0.7 });
  }
  return out;
}

/** Lamp posts down both sides of the pier, on its railings. */
export function pierLamps(): Point[] {
  const out: Point[] = [];
  const x = PIER.width / 2 + DECK_OVERHANG * 0.7;
  for (const z of [-4.5, -11, -17.5]) out.push({ x: -x, z }, { x, z });
  return out;
}

function stalls(): HarbourStall[] {
  // Along the green's far side, backing onto Front Street, facing north over the green; a gap in
  // the middle opens the green to the lane up the hill.
  const z = GREEN.z + GREEN.depth / 2 + 0.3 + STALL.depth / 2;
  return [-26.5, -20.5, -14.5, 14.5, 20.5, 26.5].map((x, i) => ({
    x,
    z,
    rotationY: Math.PI,
    width: STALL.width,
    depth: STALL.depth,
    awning: i,
  }));
}

function boats(): HarbourBoat[] {
  const out: HarbourBoat[] = [];
  // Moored down both sides of the pier, bows to the shore.
  const moored: [number, number, HarbourBoatKind, number][] = [
    [-5.9, -6.5, "dinghy", 0],
    [-6.2, -13.5, "fishing", 1],
    [-5.9, -18.8, "dinghy", 2],
    [5.9, -5, "dinghy", 3],
    [6.3, -12, "fishing", 4],
    [5.9, -18.5, "dinghy", 5],
  ];
  for (const [x, z, kind, colour] of moored) {
    out.push({ kind, x, z, heading: 0, length: kind === "fishing" ? 5.2 : 3, colour });
  }
  // Rowboats tied up along the sea wall.
  out.push({ kind: "dinghy", x: -12, z: -2.6, heading: Math.PI / 2, length: 3, colour: 6 });
  out.push({ kind: "dinghy", x: 22, z: -2.6, heading: -Math.PI / 2, length: 3, colour: 7 });
  // Sailboats at anchor, each with a lap of the bay out to open water and back.
  const sails: [number, number, number, number, number][] = [
    // x, z, heading, loop direction (radians from north towards east), loop radius
    [-46, -30, 0.6, 0.35, 15],
    [-22, -58, -0.4, 0.15, 13],
    [30, -16, 2.6, -0.25, 11],
    [28, -54, 0.3, -0.3, 13],
  ];
  sails.forEach(([x, z, heading, out_, radius], i) => {
    out.push({
      kind: "sail",
      x,
      z,
      heading,
      length: 5.4,
      colour: i,
      loop: { x: x + Math.sin(out_) * radius, z: z - Math.cos(out_) * radius, radius },
    });
  });
  return out;
}

function rocks(coast: Point[], random: () => number): HarbourRock[] {
  const out: HarbourRock[] = [];
  // Granite along the shore beyond the sea wall, half in the water.
  for (let x = -112; x <= 112; x += 1.7 + random() * 1.4) {
    if (x > SEA_WALL.from - 2 && x < SEA_WALL.to + 2) continue;
    const z = coastAt(coast, x) + (random() - 0.6) * 1.6;
    out.push({ x, z, size: 0.7 + random() * 1.1, sink: 0.5 + random() * 0.2, turn: random() * 6 });
  }
  // Armour stone down the breakwater, two rows, and round the lighthouse's island.
  const { from, to, width } = BREAKWATER;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  for (let d = 0; d <= length; d += 1.5) {
    for (const side of [-0.5, 0.5]) {
      const t = d / length;
      const nx = (to.z - from.z) / length;
      const nz = -(to.x - from.x) / length;
      out.push({
        x: from.x + (to.x - from.x) * t + nx * side * width * 0.6 + (random() - 0.5) * 0.4,
        z: from.z + (to.z - from.z) * t + nz * side * width * 0.6 + (random() - 0.5) * 0.4,
        size: 1.1 + random() * 0.5,
        sink: 0.45,
        turn: random() * 6,
      });
    }
  }
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2 + random() * 0.2;
    const r = LIGHTHOUSE.island + (random() - 0.3) * 0.8;
    out.push({
      x: LIGHTHOUSE.x + Math.cos(a) * r,
      z: LIGHTHOUSE.z + Math.sin(a) * r,
      size: 1 + random() * 0.8,
      sink: 0.5,
      turn: random() * 6,
    });
  }
  // Outcrops of the Shield on the west point, where the chairs sit.
  for (const { x, z, size } of OUTCROPS) out.push({ x, z, size, sink: 0.72, turn: random() * 6 });
  return out;
}

function chairs(): HarbourChair[] {
  // Pairs of Muskoka chairs on the outcrops, facing the bay.
  const pairs: [number, number, number][] = OUTCROPS.map((o) => [o.x, o.z, o.facing]);
  const out: HarbourChair[] = [];
  pairs.forEach(([x, z, rotationY], i) => {
    const across = { x: Math.cos(rotationY) * 0.7, z: -Math.sin(rotationY) * 0.7 };
    out.push({ x: x - across.x, z: z - across.z, rotationY: rotationY + 0.15, colour: 2 * i });
    out.push({ x: x + across.x, z: z + across.z, rotationY: rotationY - 0.15, colour: 2 * i + 1 });
  });
  return out;
}

// Five neighbourhoods: the two halves of Front Street, Hill Street, and the cottages on each
// shore. Each gets its own patch; homes are dealt round-robin, so home i is in neighbourhood
// i % 5, and patch sizes follow from that.
const NEIGHBOURHOOD_NAMES = [
  "Front Street West",
  "Front Street East",
  "Hill Street",
  "West Point",
  "East Shore",
];

interface Site extends Point {
  rotationY: number;
  width: number;
  depth: number;
  storeys: number;
}

function streetSites(
  count: number,
  front: number,
  pitch: number,
  firstX: number,
  step: number,
  random: () => number,
): Site[] {
  return Array.from({ length: count }, (_, k) => {
    const width = HOME_WIDTH + (random() - 0.5) * 0.6;
    const depth = HOME_DEPTH + (random() - 0.5) * 0.4;
    return {
      x: firstX + k * step * pitch,
      z: front + depth / 2,
      rotationY: Math.PI,
      width,
      depth,
      storeys: random() < 0.35 ? 3 : 2,
    };
  });
}

function cottageSites(
  count: number,
  region: { minX: number; maxX: number; minZ: number; maxZ: number },
  coast: Point[],
  taken: Point[],
  random: () => number,
): Site[] {
  const sites: Site[] = [];
  const bay = { x: 0, z: -40 };
  for (let tries = 0; sites.length < count && tries < 4000; tries++) {
    const p = {
      x: region.minX + random() * (region.maxX - region.minX),
      z: region.minZ + random() * (region.maxZ - region.minZ),
    };
    if (!onLand(coast, p, 6)) continue;
    if ([...taken, ...sites].some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 8)) continue;
    if (LANES.some((l) => insideRect(p, l, 4))) continue;
    // Turned to look out over the bay, give or take.
    const rotationY = Math.atan2(bay.x - p.x, bay.z - p.z) + (random() - 0.5) * 0.4;
    sites.push({
      ...p,
      rotationY,
      width: 3 + random() * 0.4,
      depth: 3.1,
      storeys: 1 + Math.round(random()),
    });
  }
  if (sites.length < count)
    throw new Error(`layoutHarbour: room for only ${sites.length} cottages`);
  return sites;
}

function homes(
  homeCount: number,
  neighbourhoodCount: number,
  coast: Point[],
  random: () => number,
): { homes: HarbourHome[]; neighbourhoods: HarbourNeighbourhood[] } {
  if (neighbourhoodCount !== HARBOUR_NEIGHBOURHOODS) {
    throw new RangeError(
      `layoutHarbour: ${neighbourhoodCount} neighbourhoods, want ${HARBOUR_NEIGHBOURHOODS}`,
    );
  }
  // Dealt round-robin, neighbourhood n gets every fifth home from n.
  const counts = Array.from({ length: neighbourhoodCount }, (_, n) =>
    Math.max(0, Math.ceil((homeCount - n) / neighbourhoodCount)),
  );
  const row = (n: number, side: number) =>
    streetSites(counts[n], ROW_FRONT, ROW_PITCH, side * 4, side, random);
  const sites: Site[][] = [
    row(0, -1),
    row(1, 1),
    streetSites(counts[2], HILL_FRONT, HILL_PITCH, (-(counts[2] - 1) * HILL_PITCH) / 2, 1, random),
  ];
  sites.push(
    cottageSites(
      counts[3],
      { minX: -100, maxX: -50, minZ: -60, maxZ: 26 },
      coast,
      OUTCROPS,
      random,
    ),
  );
  sites.push(
    cottageSites(counts[4], { minX: 54, maxX: 104, minZ: -30, maxZ: 30 }, coast, OUTCROPS, random),
  );

  const next = new Array(neighbourhoodCount).fill(0);
  const out: HarbourHome[] = [];
  for (let i = 0; i < homeCount; i++) {
    const n = i % neighbourhoodCount;
    const s = sites[n][next[n]++];
    const wallHeight = s.storeys * STOREY + 0.25;
    out.push({
      index: i,
      neighbourhood: n,
      x: s.x,
      z: s.z,
      width: s.width,
      depth: s.depth,
      rotationY: s.rotationY,
      wallHeight,
      roofHeight: 1.1 + s.width * 0.18,
      roof: random() < 0.55 ? "front" : "side",
      body: Math.floor(random() * 10),
      roofColour: Math.floor(random() * 4),
      door: Math.floor(random() * 5),
    });
  }
  const neighbourhoods = counts.map((homeCount, n) => {
    const mine = out.filter((h) => h.neighbourhood === n);
    const centre = mine.length
      ? {
          x: mine.reduce((s, h) => s + h.x, 0) / mine.length,
          z: mine.reduce((s, h) => s + h.z, 0) / mine.length,
        }
      : { x: 0, z: 0 };
    return { index: n, name: NEIGHBOURHOOD_NAMES[n], homeCount, centre };
  });
  return { homes: out, neighbourhoods };
}

/** Top of a home's chimney. */
export function homeTop(h: HarbourHome): number {
  return h.wallHeight + h.roofHeight + CHIMNEY;
}

/** Everything a tree's canopy must keep clear of, with how far. */
interface Clearance {
  box: Box;
  gap: number;
}

// Picnic tables on the lawns between the green and the ends of the boardwalk, each side.
function picnics(): HarbourPicnic[] {
  const out: HarbourPicnic[] = [];
  for (const side of [-1, 1]) {
    for (const [x, z, turn] of [
      [35.5, 12.5, 0.15],
      [40.5, 18.5, -0.2],
      [35, 25, 0.1],
    ]) {
      out.push({ x: side * x, z, width: 2.1, depth: 1.9, rotationY: side * turn });
    }
  }
  return out;
}

function trees(
  coast: Point[],
  homes: HarbourHome[],
  props: HarbourProp[],
  stalls: HarbourStall[],
  tables: HarbourPicnic[],
  random: () => number,
): HarbourTree[] {
  const clear: Clearance[] = [
    ...[GREEN, BOARDWALK, PIER, PIERHEAD, WHEEL_PLATFORM].map((r) => ({ box: rectBox(r), gap: 1 })),
    ...LANES.map((r) => ({ box: rectBox(r), gap: 0.6 })),
    ...homes.map((h) => ({ box: h as Box, gap: 1.2 })),
    ...stalls.map((s) => ({ box: s as Box, gap: 1 })),
    ...tables.map((t) => ({ box: t, gap: 1.2 })),
    ...props.map((p) => ({ box: p as Box, gap: 0.6 })),
    ...OUTCROPS.map((o) => ({
      box: { x: o.x, z: o.z, width: 2 * o.size, depth: 2 * o.size, rotationY: 0 },
      gap: 1.5,
    })),
  ];
  const out: HarbourTree[] = [...GREEN_MAPLES];
  const regions: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    count: number;
    pines: number;
  }[] = [
    { minX: -110, maxX: -46, minZ: -80, maxZ: 40, count: 115, pines: 0.8 }, // the west point
    { minX: 46, maxX: 120, minZ: -60, maxZ: 40, count: 115, pines: 0.7 }, // the east shore
    { minX: -75, maxX: 75, minZ: 36, maxZ: 110, count: 230, pines: 0.45 }, // the hill behind town
    { minX: -46, maxX: -31, minZ: 9, maxZ: 31, count: 5, pines: 0 }, // the picnic lawns
    { minX: 31, maxX: 46, minZ: 9, maxZ: 31, count: 5, pines: 0 },
  ];
  for (const r of regions) {
    let placed = 0;
    for (let tries = 0; placed < r.count && tries < r.count * 40; tries++) {
      const p = {
        x: r.minX + random() * (r.maxX - r.minX),
        z: r.minZ + random() * (r.maxZ - r.minZ),
      };
      const kind: HarbourTreeKind = random() < r.pines ? "pine" : "maple";
      const size = 0.8 + random() * 0.5;
      const radius = (kind === "pine" ? PINE_RADIUS : MAPLE_RADIUS) * size;
      if (!onLand(coast, p, radius + 1.5)) continue;
      if (clear.some((c) => distanceToBox(p.x, p.z, c.box) < radius + c.gap)) continue;
      if (Math.hypot(p.x - LIGHTHOUSE.x, p.z - LIGHTHOUSE.z) < LIGHTHOUSE.island + radius) continue;
      const crowded = out.some((t) => {
        const tr = (t.kind === "pine" ? PINE_RADIUS : MAPLE_RADIUS) * t.size;
        return Math.hypot(t.x - p.x, t.z - p.z) < tr + radius + 0.3;
      });
      if (crowded) continue;
      out.push({ kind, x: p.x, z: p.z, size });
      placed++;
    }
  }
  return out;
}

// Kites flown from the tops of three festoon poles, out over the water on the onshore breeze.
function kites(props: HarbourProp[]): HarbourKite[] {
  const poles = props.filter((p) => p.kind === "pole");
  const flights: [number, number, number, number][] = [
    // pole, x, z, height
    [3, -17, 3, 17],
    [1, 10, 0, 20.5],
    [0, 25, 7, 15],
  ];
  return flights.map(([pole, x, z, height], colour) => ({
    x,
    z,
    height,
    colour,
    anchor: { x: poles[pole].x, z: poles[pole].z },
  }));
}

function treeSolid(t: HarbourTree): Solid {
  const radius = t.kind === "pine" ? PINE_RADIUS : MAPLE_RADIUS;
  const height = t.kind === "pine" ? PINE_HEIGHT : MAPLE_HEIGHT;
  const span = 2 * radius * t.size;
  return { x: t.x, z: t.z, width: span, depth: span, rotationY: 0, height: height * t.size };
}

/** The harbour for `homeCount` homes in `neighbourhoodCount` neighbourhoods. */
export function layoutHarbour(homeCount: number, neighbourhoodCount: number): HarbourLayout {
  const random = seededRandom(0x4ab0);
  const coast = buildCoast(random);
  const props = walkObstacleProps();
  const stallList = stalls();
  const village = homes(homeCount, neighbourhoodCount, coast, random);
  const tables = picnics();
  const treeList = trees(coast, village.homes, props, stallList, tables, random);

  const wheel = { x: 0, z: WHEEL_PLATFORM.z, ...WHEEL, platform: WHEEL_PLATFORM };
  const screen = {
    barge: { ...BARGE },
    panel: {
      width: SCREEN.width,
      height: SCREEN.height,
      y: SCREEN.deck + SCREEN.lift + SCREEN.height / 2,
    },
    deck: SCREEN.deck,
  };
  const screenTop = WATER_LEVEL + screen.panel.y + SCREEN.height / 2 + 0.4;
  const wheelTop = WHEEL.hub + WHEEL.radius + 1.2;

  const solids: Solid[] = [
    ...village.homes.map((h) => ({ ...h, height: homeTop(h) })),
    ...stallList.map((s) => ({ ...s, height: STALL_HEIGHT })),
    ...props
      .filter((p) => p.kind === "pole")
      .map((p) => ({ ...p, width: 0.6, depth: 0.6, height: POLE_HEIGHT })),
    ...[...boardwalkLamps(), ...pierLamps()].map((p) => ({
      ...p,
      width: 0.5,
      depth: 0.5,
      rotationY: 0,
      height: LAMP_HEIGHT,
    })),
    {
      x: CAROUSEL.x,
      z: CAROUSEL.z,
      width: 2 * CAROUSEL.radius,
      depth: 2 * CAROUSEL.radius,
      rotationY: 0,
      height: CAROUSEL.height + 0.8,
    },
    {
      x: wheel.x,
      z: wheel.z,
      width: 2 * WHEEL.radius + 2,
      depth: 3,
      rotationY: 0,
      height: wheelTop,
    },
    {
      x: LIGHTHOUSE.x,
      z: LIGHTHOUSE.z,
      width: 4,
      depth: 4,
      rotationY: 0,
      height: LIGHTHOUSE.height + 1,
    },
    { ...BARGE, height: screenTop },
    ...treeList.map(treeSolid),
  ];

  return {
    green: GREEN,
    boardwalk: BOARDWALK,
    pier: PIER,
    pierhead: PIERHEAD,
    coast,
    lanes: LANES,
    homes: village.homes,
    neighbourhoods: village.neighbourhoods,
    trees: treeList,
    props,
    stalls: stallList,
    picnics: tables,
    chairs: chairs(),
    rocks: rocks(coast, random),
    boats: boats(),
    festoons: festoons(props),
    kites: kites(props),
    carousel: { ...CAROUSEL },
    wheel,
    lighthouse: LIGHTHOUSE,
    breakwater: BREAKWATER,
    screen,
    bounds: { minX: -95, maxX: 95, minZ: -70, maxZ: 60 },
    solids,
    height: Math.max(...solids.map((s) => s.height)),
  };
}

/** How far a blob keeps from the carousel's middle: its platform, then its fence. */
export function carouselReach(layout: HarbourLayout): number {
  return layout.carousel.radius + CAROUSEL_FENCE;
}

// Pure, deterministic town layout: plain data in world units (an adult blob is ~1 tall).
// No three.js, DOM, Math.random or clock, so the same counts always give the same town.
//
// A small grid town. The square sits in the middle cell: open paving with one news screen at
// its north end facing south over the crowd (and towards the default camera, which looks
// north). The town hall faces it from across the street to the north. Main Street runs along
// the square's south side, lined with two-storey shops on both sides, and shops face the
// square across its east and west streets too.
//
// Neighbourhoods grow out from that downtown, block by block, each towards its own compass
// direction, so each is one patch of town. A block of homes is two rows of lots back to
// back, every house fronting a street with a front walk from its door to the sidewalk.
// Every block is ringed by a sidewalk (inside its rectangle) and by streets, which all join
// up; Main Street runs on out of town into the fields at both ends.

import { type Box, distanceToBox, type Point, seededRandom, type Solid } from "./mapLayout.ts";

/** A home's size before its seeded variety: width along the street, depth front to back. */
export const HOME_WIDTH = 2.8;
export const HOME_DEPTH = 2.4;
export const HOME_WALL_HEIGHT = 1.7; // a 1-unit adult blob fits under the door
export const HOME_ROOF_HEIGHT = 1.1;
/** Top of a home's chimney, before its heightScale; TownHomes draws it this tall. */
export const HOME_TOP = 2.95;

export const STREET = 3.4;
export const MAIN_STREET = 4.8;
/** The paved edge of every block but the square, inside the block's rectangle. */
export const SIDEWALK = 1.2;
export const WALK_WIDTH = 0.7;

/** Top of a lamp's lantern, as TownSquare draws it. */
export const LAMP_HEIGHT = 2.7;

export const SHOP_DEPTH = 5;
/** How far plant on a shop's roof stands above its parapet. */
export const ROOF_PLANT = 0.5;
export const SCREEN_BEZEL = 0.35;

// Trees: canopy size and height of a size-1 tree, as TownTrees draws it.
export const TREE_RADIUS = 1.1;
export const TREE_HEIGHT = 3.2;

const BLOCK_X = 16; // three lots a side
const BLOCK_Z = 13;
const LOT_FRONTAGE = 4.4; // the narrowest lot
const LOT_GAP = 1; // clear ground between neighbouring homes, at least
const SETBACK = 0.9; // a home's front to the sidewalk, at least
const SETBACK_SPREAD = 0.4;
const TURN = 0.04; // radians a home may sit off square to its street

// The square grows past its base size so there is standing room for 2 blobs per home.
const SQUARE_X = 28;
const SQUARE_Z = 20;
const SQUARE_AREA_PER_HOME = 10;
const SQUARE_TREE_INSET = 2.2;
const SQUARE_TREE_SPACING = 5;
const SQUARE_TREE_SIZE = 0.85;
const BENCH = { width: 1.8, depth: 0.7 };
const LAMP = 0.35; // footprint of a lamp post's base
const BED = { gap: 0.4, edge: 0.5, depth: 3.5 }; // the flower beds beside the screen

const SCREEN_WIDTH = 8;
const SCREEN_HEIGHT = 4.5; // 16:9
const SCREEN_BOTTOM = 2.2; // over the heads of the crowd
const SCREEN_BACK = 1.6; // the panel's distance in from the square's north edge
const SCREEN_POST = 0.5;

const SHOP_FRONTAGE = 4.5;
const SHOP_HEIGHT = { min: 3.9, max: 4.7 }; // two storeys and a parapet
const HALL = { width: 15, depth: 7.4, portico: 1.2, forecourt: 1.8, height: 6.4 };
const HALL_TOWER = { size: 2.6, height: 11.8 };

// Square units of open ground per tree: a leafy green, a few round the town hall, the odd
// one in the yards behind the shops. Homes' lots and the square plant their own.
const GROUND_PER_TREE: Partial<Record<TownBlockKind, number>> = {
  park: 10,
  townHall: 14,
  shops: 45,
};

const ROAD_OUT = 70; // Main Street on into the fields
const TREE_GAP = 0.3; // clear ground round every canopy
const TREE_BELT = 20; // width of the fields round the town that get trees
const FIELD_TREES = 0.006; // per square unit
const FIELD_VERGE = 1.5; // fields keep their trees this far off blocks and streets

export interface TownRect extends Point {
  width: number; // along x
  depth: number; // along z
}

export type TownBlockKind = "square" | "townHall" | "shops" | "homes" | "park";

export interface TownBlock extends TownRect {
  kind: TownBlockKind;
  /** The neighbourhood whose homes it holds, or -1. */
  neighbourhood: number;
}

/** Roadway, axis-aligned; pieces meet edge to edge at junctions. */
export interface TownStreet extends TownRect {
  /** Part of Main Street. */
  main: boolean;
  /** Main Street running out of town, past the bounds. */
  out: boolean;
}

export interface TownHome extends Box {
  index: number;
  neighbourhood: number;
  /** Scales the home's height (walls, roof, chimney). */
  heightScale: number;
  /** "side": the ridge runs along the street; "front": the gable faces it. */
  roof: "side" | "front";
}

export interface TownBuilding extends Box {
  kind: "shop" | "townHall";
  /** Top of the roof or parapet. Its front (door side) faces local +z. */
  height: number;
  /** A clock tower rising above the roof. */
  tower?: Solid;
}

/** A flat panel facing its local +z. */
export interface TownPanel extends Point {
  y: number; // centre height
  width: number;
  height: number;
  rotationY: number;
}

export interface TownScreen {
  panel: TownPanel;
  /** Ground under the frame, posts and plinth. */
  footprint: Box;
  /** Top of the frame. */
  top: number;
}

export interface TownProp extends Box {
  kind: "bench" | "lamp" | "bed";
}

export interface TownTree extends Point {
  /** Scales a canopy of TREE_RADIUS. */
  size: number;
}

export interface TownNeighbourhood extends Point {
  index: number;
  homeCount: number;
}

export interface TownBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TownLayout {
  /** homes[i] belongs to neighbourhood i % neighbourhoodCount (dealt round-robin). */
  homes: TownHome[];
  /** walks[i] runs from homes[i]'s door to its sidewalk. */
  walks: TownRect[];
  /** Each centred on the middle of its homes. */
  neighbourhoods: TownNeighbourhood[];
  square: TownRect;
  screen: TownScreen;
  blocks: TownBlock[];
  streets: TownStreet[];
  buildings: TownBuilding[];
  /** Benches, lamps and flower beds on the square. */
  props: TownProp[];
  /** Trees may stand in the fields outside the bounds. */
  trees: TownTree[];
  /** The town itself: every block and street but the road out. */
  bounds: TownBounds;
  /** Height of the tallest thing in town. */
  height: number;
}

type Cell = [i: number, j: number];

type Rect = TownBounds;

interface CellUse {
  cell: Cell;
  kind: TownBlockKind;
  neighbourhood: number;
}

const rectOf = (r: Rect): TownRect => ({
  x: (r.minX + r.maxX) / 2,
  z: (r.minZ + r.maxZ) / 2,
  width: r.maxX - r.minX,
  depth: r.maxZ - r.minZ,
});

const edgesOf = (r: TownRect): Rect => ({
  minX: r.x - r.width / 2,
  maxX: r.x + r.width / 2,
  minZ: r.z - r.depth / 2,
  maxZ: r.z + r.depth / 2,
});

const inset = (r: Rect, by: number): Rect => ({
  minX: r.minX + by,
  maxX: r.maxX - by,
  minZ: r.minZ + by,
  maxZ: r.maxZ - by,
});

const EMPTY: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };

// The smallest rectangle round both.
function extend(acc: Rect, r: TownRect): Rect {
  const e = edgesOf(r);
  return {
    minX: Math.min(acc.minX, e.minX),
    maxX: Math.max(acc.maxX, e.maxX),
    minZ: Math.min(acc.minZ, e.minZ),
    maxZ: Math.max(acc.maxZ, e.maxZ),
  };
}

const key = ([i, j]: Cell) => `${i},${j}`;
const ringOf = ([i, j]: Cell) => Math.max(Math.abs(i), Math.abs(j));

// The middle of town: the square, the town hall, and the shops round the square and along
// both sides of Main Street.
const DOWNTOWN: [Cell, TownBlockKind][] = [
  [[0, 0], "square"],
  [[0, -1], "townHall"],
  [[-1, 0], "shops"],
  [[1, 0], "shops"],
  [[-1, 1], "shops"],
  [[0, 1], "shops"],
  [[1, 1], "shops"],
];
// The corners beside the town hall: greens, unless homes take them.
const GREENS: Cell[] = [
  [-1, -1],
  [1, -1],
];

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
  const random = seededRandom(Math.imul(homeCount, 0x9e3779b1) ^ Math.imul(n, 0x85ebca6b));

  const grow = Math.max(1, Math.sqrt((homeCount * SQUARE_AREA_PER_HOME) / (SQUARE_X * SQUARE_Z)));
  const grid = makeGrid(SQUARE_X * grow, SQUARE_Z * grow);

  const cells = new Map<string, CellUse>();
  for (const [cell, kind] of DOWNTOWN) cells.set(key(cell), { cell, kind, neighbourhood: -1 });
  const claims = claimCells(sizes, grid, cells);
  for (const cell of [...GREENS, ...notches(cells)]) {
    if (!cells.has(key(cell))) cells.set(key(cell), { cell, kind: "park", neighbourhood: -1 });
  }
  const used = [...cells.values()];
  const blocks: TownBlock[] = used.map(({ cell, kind, neighbourhood }) => ({
    ...rectOf(grid.cell(cell)),
    kind,
    neighbourhood,
  }));
  const streets = layoutStreets(
    used.map((c) => c.cell),
    grid,
  );
  const bounds = streets.filter((s) => !s.out).reduce(extend, blocks.reduce(extend, EMPTY));

  // Each neighbourhood spreads its homes evenly over its lots, home j * n + k taking lot j's
  // share; the lots left over get a tree.
  const homes: TownHome[] = new Array(homeCount);
  const walks: TownRect[] = new Array(homeCount);
  const vacant: Rect[] = [];
  const lots = claims.map((owned) => owned.flatMap((cell) => lotsOf(grid, cell)));
  lots.forEach((mine, k) => {
    const taken = new Set<number>();
    for (let j = 0; j < sizes[k]; j++) {
      const slot = Math.floor((j * mine.length) / sizes[k]);
      taken.add(slot);
      const { home, walk } = buildHome(mine[slot], random);
      homes[j * n + k] = { index: j * n + k, neighbourhood: k, ...home };
      walks[j * n + k] = walk;
    }
    mine.forEach((lot, s) => {
      if (!taken.has(s)) vacant.push(lot.rect);
    });
  });

  const square = grid.cell([0, 0]);
  const { screen, props, trees } = layoutSquare(square);
  const buildings = [...layoutShops(grid, random), layoutHall(inset(grid.cell([0, -1]), SIDEWALK))];

  // Trees go wherever they fit: a lot nobody lives on, out back in the yards, on the greens,
  // round the town hall and behind the shops, then in the fields.
  const built: Box[] = [
    ...homes,
    ...buildings,
    screen.footprint,
    ...props,
    ...walks.map((w) => ({ ...w, rotationY: 0 })),
  ];
  const plant = (tree: TownTree, within: Rect) => {
    const r = TREE_RADIUS * tree.size;
    const fits =
      tree.x >= within.minX + r &&
      tree.x <= within.maxX - r &&
      tree.z >= within.minZ + r &&
      tree.z <= within.maxZ - r &&
      built.every((b) => distanceToBox(tree.x, tree.z, b) >= r + TREE_GAP) &&
      trees.every(
        (t) => Math.hypot(t.x - tree.x, t.z - tree.z) >= r + TREE_RADIUS * t.size + TREE_GAP,
      );
    if (fits) trees.push(tree);
  };
  for (const lot of vacant) {
    const middle = { x: (lot.minX + lot.maxX) / 2, z: (lot.minZ + lot.maxZ) / 2 };
    plant({ ...middle, size: 0.9 + random() * 0.25 }, lot);
  }
  for (const { rect, back } of lots.flat()) {
    // A tree out back in about half the yards, against the line where the yards meet.
    if (random() > 0.5) continue;
    const size = 0.6 + random() * 0.25;
    const x = rect.minX + (0.25 + random() * 0.5) * (rect.maxX - rect.minX);
    const z = back - Math.sign(back - (rect.minZ + rect.maxZ) / 2) * TREE_RADIUS * size;
    plant({ x, z, size }, rect);
  }
  for (const block of blocks) {
    const perTree = GROUND_PER_TREE[block.kind];
    if (!perTree) continue;
    const ground = inset(edgesOf(block), SIDEWALK);
    const area = (ground.maxX - ground.minX) * (ground.maxZ - ground.minZ);
    const wanted = trees.length + Math.round(area / perTree);
    for (let tries = 0; tries < area && trees.length < wanted; tries++) {
      const x = ground.minX + random() * (ground.maxX - ground.minX);
      const z = ground.minZ + random() * (ground.maxZ - ground.minZ);
      plant({ x, z, size: 0.8 + random() * 0.35 }, ground);
    }
  }
  plantFields(trees, bounds, [...blocks, ...streets], random);

  const neighbourhoods = sizes.map((homeCount, k) => {
    const mine: Point[] = homes.filter((h) => h.neighbourhood === k);
    const around = mine.length > 0 ? mine : claims[k].map((c) => rectOf(grid.cell(c)));
    const centre =
      around.length > 0
        ? {
            x: around.reduce((s, p) => s + p.x, 0) / around.length,
            z: around.reduce((s, p) => s + p.z, 0) / around.length,
          }
        : { x: 0, z: 0 };
    return { index: k, homeCount, ...centre };
  });

  const height = Math.max(
    screen.top,
    ...homes.map((h) => HOME_TOP * h.heightScale),
    ...buildings.map((b) => b.tower?.height ?? b.height + ROOF_PLANT),
    ...trees.map((t) => TREE_HEIGHT * t.size),
  );

  return {
    homes,
    walks,
    neighbourhoods,
    square: rectOf(square),
    screen,
    blocks,
    streets,
    buildings,
    props,
    trees,
    bounds,
    height,
  };
}

interface Grid {
  cell(cell: Cell): Rect;
  /** The street between column i and i + 1, as its x range. */
  gapX(i: number): [number, number];
  /** The street between row j and j + 1, as its z range; Main Street is the one at 0. */
  gapZ(j: number): [number, number];
}

// Column i spans x and row j spans z; the middle ones hold the square. Main Street is the
// wider gap south of row 0.
function makeGrid(squareX: number, squareZ: number): Grid {
  const span = (k: number, middle: number, block: number, gap: (t: number) => number) => {
    if (k === 0) return [-middle / 2, middle / 2] as const;
    let edge = middle / 2;
    for (let t = 0; t < Math.abs(k); t++) edge += gap(k > 0 ? t : -t - 1) + (t > 0 ? block : 0);
    return k > 0 ? ([edge, edge + block] as const) : ([-edge - block, -edge] as const);
  };
  const col = (i: number) => span(i, squareX, BLOCK_X, () => STREET);
  const row = (j: number) => span(j, squareZ, BLOCK_Z, (t) => (t === 0 ? MAIN_STREET : STREET));
  return {
    cell([i, j]) {
      const [minX, maxX] = col(i);
      const [minZ, maxZ] = row(j);
      return { minX, maxX, minZ, maxZ };
    },
    gapX: (i) => [col(i)[1], col(i + 1)[0]],
    gapZ: (j) => [row(j)[1], row(j + 1)[0]],
  };
}

// Neighbourhoods take turns claiming one block at a time until their lots hold their homes.
// Each grows out from downtown towards its own compass direction (neighbourhood 0 due north,
// the rest clockwise round from it). It takes a free cell touching the town, so the town
// stays in one piece, preferring in turn: one beside its own blocks, one in its own sector,
// one nearer the middle of town, one nearer its direction. Returns each neighbourhood's
// cells in the order claimed.
function claimCells(sizes: number[], grid: Grid, cells: Map<string, CellUse>): Cell[][] {
  const n = sizes.length;
  const direction = (k: number) => -Math.PI / 2 + (2 * Math.PI * k) / n;
  const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const angle = (cell: Cell) => {
    const { x, z } = rectOf(grid.cell(cell));
    return Math.atan2(z, x);
  };
  const sectorOf = (cell: Cell) => {
    let best = 0;
    for (let k = 1; k < n; k++) {
      if (off(angle(cell), direction(k)) < off(angle(cell), direction(best)) - 1e-9) best = k;
    }
    return best;
  };
  const touches = ([i, j]: Cell, owner?: number) => {
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const use = cells.get(key([i + di, j + dj]));
        if (use && (owner === undefined || use.neighbourhood === owner)) return true;
      }
    }
    return false;
  };
  const pick = (k: number): Cell => {
    const reach = Math.max(...[...cells.values()].map((c) => ringOf(c.cell))) + 1;
    let best: Cell = [0, 0];
    let bestScore = [Infinity];
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        const cell: Cell = [i, j];
        if (cells.has(key(cell)) || !touches(cell)) continue;
        const score = [
          touches(cell, k) ? 0 : 1,
          sectorOf(cell) === k ? 0 : 1,
          ringOf(cell),
          off(angle(cell), direction(k)),
        ];
        const better = score.findIndex((s, t) => Math.abs(s - bestScore[t]) > 1e-9);
        if (better >= 0 && score[better] < bestScore[better]) {
          best = cell;
          bestScore = score;
        }
      }
    }
    return best;
  };

  const claims: Cell[][] = sizes.map(() => []);
  const need = [...sizes];
  while (need.some((left) => left > 0)) {
    for (let k = 0; k < n; k++) {
      if (need[k] <= 0) continue;
      const cell = pick(k);
      cells.set(key(cell), { cell, kind: "homes", neighbourhood: k });
      claims[k].push(cell);
      need[k] -= lotsOf(grid, cell).length;
    }
  }
  return claims;
}

// Free cells boxed in by blocks on three or four sides: greens, so the town has no ragged
// notches. Found from the town as it stands, so the order of filling never matters.
function notches(cells: Map<string, CellUse>): Cell[] {
  const found = new Map<string, Cell>();
  for (const { cell } of cells.values()) {
    for (const [di, dj] of SIDES) {
      const free: Cell = [cell[0] + di, cell[1] + dj];
      if (cells.has(key(free)) || found.has(key(free))) continue;
      const walls = SIDES.filter(([a, b]) => cells.has(key([free[0] + a, free[1] + b])));
      if (walls.length >= 3) found.set(key(free), free);
    }
  }
  return [...found.values()];
}

const SIDES: Cell[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

interface Lot {
  rect: Rect;
  /** Where the lot meets the sidewalk (a z), and the way its home faces. */
  front: number;
  facing: 1 | -1;
  /** Where the lot meets the yard behind it (a z). */
  back: number;
}

// Two rows of lots back to back across a block, fronting the streets north and south of it.
function lotsOf(grid: Grid, cell: Cell): Lot[] {
  const ground = inset(grid.cell(cell), SIDEWALK);
  const width = ground.maxX - ground.minX;
  const count = Math.max(1, Math.floor(width / LOT_FRONTAGE));
  const frontage = width / count;
  const middle = (ground.minZ + ground.maxZ) / 2;
  const lots: Lot[] = [];
  for (const facing of [-1, 1] as const) {
    for (let s = 0; s < count; s++) {
      const minX = ground.minX + s * frontage;
      const maxX = minX + frontage;
      lots.push(
        facing < 0
          ? {
              rect: { minX, maxX, minZ: ground.minZ, maxZ: middle },
              front: ground.minZ,
              facing,
              back: middle,
            }
          : {
              rect: { minX, maxX, minZ: middle, maxZ: ground.maxZ },
              front: ground.maxZ,
              facing,
              back: middle,
            },
      );
    }
  }
  return lots;
}

// A home on its lot, each a little different: its size and height, its setback, a touch off
// square to the street and off the middle of the lot. It never leaves its lot's clear ground.
function buildHome(
  lot: Lot,
  random: () => number,
): { home: Omit<TownHome, "index" | "neighbourhood">; walk: TownRect } {
  const frontage = lot.rect.maxX - lot.rect.minX;
  const turn = (random() * 2 - 1) * TURN;
  const width = Math.min(HOME_WIDTH * (0.92 + random() * 0.22), frontage - LOT_GAP - 0.2);
  const depth = HOME_DEPTH * (0.95 + random() * 0.17);
  // Furthest a corner moves when the home turns.
  const slack = Math.hypot(width / 2, depth / 2) * Math.sin(Math.abs(turn));
  const shiftRoom = Math.max(0, (frontage - width - LOT_GAP) / 2 - slack);
  const x = (lot.rect.minX + lot.rect.maxX) / 2 + (random() * 2 - 1) * shiftRoom * 0.6;
  const setback = SETBACK + random() * SETBACK_SPREAD + slack;
  const z = lot.front - lot.facing * (setback + depth / 2);
  const rotationY = (lot.facing > 0 ? 0 : Math.PI) + turn;
  const door = {
    x: x + (Math.sin(rotationY) * depth) / 2,
    z: z + (Math.cos(rotationY) * depth) / 2,
  };
  const walk = rectOf({
    minX: door.x - WALK_WIDTH / 2,
    maxX: door.x + WALK_WIDTH / 2,
    minZ: Math.min(door.z, lot.front),
    maxZ: Math.max(door.z, lot.front),
  });
  return {
    home: {
      x,
      z,
      width,
      depth,
      rotationY,
      heightScale: 0.92 + random() * 0.25,
      roof: random() < 0.35 ? "front" : "side",
    },
    walk,
  };
}

// Every block's streets: the one along each side and the junctions at its corners. Pieces
// are shared between neighbouring blocks, so each is kept once.
function layoutStreets(cells: Cell[], grid: Grid): TownStreet[] {
  const pieces = new Map<string, TownStreet>();
  const add = (name: string, r: Rect, main: boolean) => {
    if (!pieces.has(name)) pieces.set(name, { ...rectOf(r), main, out: false });
  };
  for (const [i, j] of cells) {
    const r = grid.cell([i, j]);
    for (const gi of [i - 1, i]) {
      const [minX, maxX] = grid.gapX(gi);
      add(`x${gi},${j}`, { minX, maxX, minZ: r.minZ, maxZ: r.maxZ }, false);
    }
    for (const gj of [j - 1, j]) {
      const [minZ, maxZ] = grid.gapZ(gj);
      add(`z${i},${gj}`, { minX: r.minX, maxX: r.maxX, minZ, maxZ }, gj === 0);
      for (const gi of [i - 1, i]) {
        const [minX, maxX] = grid.gapX(gi);
        add(`j${gi},${gj}`, { minX, maxX, minZ, maxZ }, gj === 0);
      }
    }
  }
  const streets = [...pieces.values()];
  // Main Street carries on out of town into the fields at both ends.
  const main = streets.filter((s) => s.main).reduce(extend, EMPTY);
  for (const [minX, maxX] of [
    [main.minX - ROAD_OUT, main.minX],
    [main.maxX, main.maxX + ROAD_OUT],
  ]) {
    streets.push({ ...rectOf({ ...main, minX, maxX }), main: true, out: true });
  }
  return streets;
}

// The square: open paving with the news screen at its north end facing south over the
// crowd, a row of trees with benches between them down each of its east and west sides, and
// a lamp in each corner. The middle is left clear for blobs to gather.
function layoutSquare(square: Rect): { screen: TownScreen; props: TownProp[]; trees: TownTree[] } {
  const middle = (square.minX + square.maxX) / 2;
  const panel: TownPanel = {
    x: middle,
    y: SCREEN_BOTTOM + SCREEN_HEIGHT / 2,
    z: square.minZ + SCREEN_BACK,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    rotationY: 0,
  };
  const screen: TownScreen = {
    panel,
    footprint: {
      x: middle,
      z: panel.z - 0.2,
      width: SCREEN_WIDTH + 2 * (SCREEN_BEZEL + SCREEN_POST),
      depth: 1.6,
      rotationY: 0,
    },
    top: SCREEN_BOTTOM + SCREEN_HEIGHT + SCREEN_BEZEL + 0.3,
  };

  // A flower bed either side of the screen fills each north corner, so nobody stands beside
  // or behind it.
  const props: TownProp[] = [];
  const bedFrom = screen.footprint.width / 2 + BED.gap;
  const bedTo = (square.maxX - square.minX) / 2 - BED.edge;
  for (const side of [-1, 1]) {
    props.push({
      kind: "bed",
      x: middle + (side * (bedFrom + bedTo)) / 2,
      z: square.minZ + BED.edge + BED.depth / 2,
      width: bedTo - bedFrom,
      depth: BED.depth,
      rotationY: 0,
    });
  }

  // South of the beds, a row of trees down each side with a bench between each pair, facing
  // into the square, and a lamp in each south corner.
  const trees: TownTree[] = [];
  const first = square.minZ + BED.edge + BED.depth + SQUARE_TREE_INSET;
  const last = square.maxZ - SQUARE_TREE_INSET;
  const count = Math.max(2, Math.floor((last - first) / SQUARE_TREE_SPACING) + 1);
  const step = (last - first) / (count - 1);
  for (const side of [-1, 1]) {
    const x = side < 0 ? square.minX + SQUARE_TREE_INSET : square.maxX - SQUARE_TREE_INSET;
    for (let t = 0; t < count; t++) {
      const z = first + t * step;
      trees.push({ x, z, size: SQUARE_TREE_SIZE });
      if (t > 0) {
        const rotationY = (-side * Math.PI) / 2;
        props.push({ kind: "bench", x, z: z - step / 2, ...BENCH, rotationY });
      }
    }
    const lamp = side < 0 ? square.minX + 1 : square.maxX - 1;
    props.push({
      kind: "lamp",
      x: lamp,
      z: square.maxZ - 1,
      width: LAMP,
      depth: LAMP,
      rotationY: 0,
    });
  }
  return { screen, props, trees };
}

// A row of shops along a frontage, shoulder to shoulder, each a little different in width
// and height. `start` is one end of the frontage and `along` the way it runs; `rotationY`
// turns each shop's front (local +z) out onto the street.
function shopRow(
  start: Point,
  along: Point,
  length: number,
  rotationY: number,
  random: () => number,
): TownBuilding[] {
  const count = Math.max(1, Math.round(length / SHOP_FRONTAGE));
  const weights = Array.from({ length: count }, () => 0.8 + random() * 0.4);
  const total = weights.reduce((a, b) => a + b, 0);
  const out = { x: Math.sin(rotationY), z: Math.cos(rotationY) };
  let at = 0;
  return weights.map((w) => {
    const width = (w / total) * length;
    const mid = at + width / 2;
    at += width;
    return {
      kind: "shop",
      x: start.x + along.x * mid - (out.x * SHOP_DEPTH) / 2,
      z: start.z + along.z * mid - (out.z * SHOP_DEPTH) / 2,
      width,
      depth: SHOP_DEPTH,
      rotationY,
      height: SHOP_HEIGHT.min + random() * (SHOP_HEIGHT.max - SHOP_HEIGHT.min),
    };
  });
}

// Shops along both sides of Main Street, and facing the square across its side streets. The
// rows meet at the corners; behind them is each block's yard.
function layoutShops(grid: Grid, random: () => number): TownBuilding[] {
  const shops: TownBuilding[] = [];
  for (const side of [-1, 1]) {
    const g = inset(grid.cell([side, 0]), SIDEWALK);
    // Facing the square, the whole length of the block; then north and south from behind
    // that row to the far end.
    const x = side > 0 ? g.minX : g.maxX;
    const from = side > 0 ? g.minX + SHOP_DEPTH : g.minX;
    const across = g.maxX - g.minX - SHOP_DEPTH;
    const down = { x: 0, z: 1 };
    const east = { x: 1, z: 0 };
    shops.push(
      ...shopRow({ x, z: g.minZ }, down, g.maxZ - g.minZ, (-side * Math.PI) / 2, random),
      ...shopRow({ x: from, z: g.minZ }, east, across, Math.PI, random),
      ...shopRow({ x: from, z: g.maxZ }, east, across, 0, random),
    );
  }
  for (const i of [-1, 0, 1]) {
    const g = inset(grid.cell([i, 1]), SIDEWALK);
    shops.push(
      ...shopRow({ x: g.minX, z: g.minZ }, { x: 1, z: 0 }, g.maxX - g.minX, Math.PI, random),
    );
  }
  return shops;
}

// The town hall faces the square from across the street, a forecourt in front, a portico
// over its door and a clock tower over the middle of the main block.
function layoutHall(ground: Rect): TownBuilding {
  const width = Math.min(HALL.width, ground.maxX - ground.minX - 6);
  const front = ground.maxZ - HALL.forecourt;
  const x = (ground.minX + ground.maxX) / 2;
  return {
    kind: "townHall",
    x,
    z: front - HALL.depth / 2,
    width,
    depth: HALL.depth,
    rotationY: 0,
    height: HALL.height,
    tower: {
      x,
      z: front - HALL.portico - (HALL.depth - HALL.portico) / 2,
      width: HALL_TOWER.size,
      depth: HALL_TOWER.size,
      rotationY: 0,
      height: HALL_TOWER.height,
    },
  };
}

// A seeded scatter of trees in the fields: round the town and in any open cell inside it,
// never near a block, a street or the road out.
function plantFields(trees: TownTree[], bounds: Rect, taken: TownRect[], random: () => number) {
  const outer = inset(bounds, -TREE_BELT);
  const width = outer.maxX - outer.minX;
  const depth = outer.maxZ - outer.minZ;
  const keepOff = taken.map(edgesOf);
  const wanted = trees.length + Math.round(FIELD_TREES * width * depth);
  for (let tries = 0; tries < wanted * 30 && trees.length < wanted; tries++) {
    const tree = {
      x: outer.minX + random() * width,
      z: outer.minZ + random() * depth,
      size: 0.7 + random() * 0.5,
    };
    const r = TREE_RADIUS * tree.size + FIELD_VERGE;
    const clear =
      keepOff.every(
        (t) =>
          tree.x < t.minX - r || tree.x > t.maxX + r || tree.z < t.minZ - r || tree.z > t.maxZ + r,
      ) &&
      trees.every(
        (t) =>
          Math.hypot(t.x - tree.x, t.z - tree.z) >= TREE_RADIUS * (tree.size + t.size) + TREE_GAP,
      );
    if (clear) trees.push(tree);
  }
}

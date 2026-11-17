// Pure, deterministic city layout: plain data in world units (an adult blob is ~1 tall).
// No three.js, DOM, Math.random or clock, so the same counts always give the same city.
//
// A grid of blocks with a plaza island in the middle cell, every block ringed by a sidewalk
// and every gap a road. The plaza is a bow-tie: two planted beds pinch its waist. Districts
// (neighbourhoods) take whole blocks of apartment buildings, one door per home onto the
// sidewalk; the other blocks are offices and shops. Big screens on the buildings round the
// plaza face into it and towards the default camera, which looks north from the south.
import { TREE_RADIUS, type TownTree } from "./layoutTown.ts";
import {
  type Disc,
  type MapHome,
  type MapLayout,
  type Obstacle,
  type Point,
  seededRandom,
  standingSpots,
} from "./mapLayout.ts";

export const ROAD = 7; // two 3.5 lanes
export const SIDEWALK = 2.5; // the paved edge of every block, inside its rectangle
export const VEHICLE_LENGTH = 4.2;
export const VEHICLE_WIDTH = 1.9;
export const SETBACK = 1.5; // how far a tall building's upper floors step in

const BLOCK_X = 24;
const BLOCK_Z = 18;
const PLAZA_X = 46;
const PLAZA_Z = 24;
const NOTCH = 0.22; // share of the plaza's depth each bed takes at the waist
// The plaza grows past its base size so there are standing spots for 2 blobs per home.
const PLAZA_AREA_PER_HOME = 10;
const BUILDING_GAP = 1;
const DOOR_SPACING = 3;
const DOOR_CORNER = 2; // doors keep this far from a building's corners, and so from each other round one
const SCREEN_BOTTOM = 4; // above the doors and their canopies
const SCREEN_OFF_WALL = 0.15;
const ROOFTOP = 2; // headroom for water tanks and plant on the roofs
const LAMP_INSET = 0.8;
const PARK_CLEAR = 3.5; // parked cars keep clear of junctions and their crosswalks
const TREE_BELT = 16;
const TREE_DENSITY = 0.004;

export interface CityRect extends Point {
  width: number; // along x
  depth: number; // along z
}

export interface CityBlock extends CityRect {
  /** The district (neighbourhood) it belongs to, or -1 for offices and shops. */
  neighbourhood: number;
}

export type BuildingKind = "apartments" | "offices" | "shops";

export interface CityBuilding extends CityRect {
  height: number;
  /** Where a tall building steps in by SETBACK; equal to `height` when it doesn't. */
  podium: number;
  kind: BuildingKind;
}

/** A flat panel facing its local +z: a billboard screen or a news ticker. */
export interface CityPanel extends Point {
  y: number; // centre height
  width: number;
  height: number;
  rotationY: number;
}

export type FurnitureKind = "steps" | "bench" | "planter" | "kiosk";

/** Plaza furniture. Steps and benches face local -z (north, the screens) at rotationY 0. */
export interface CityFurniture extends CityRect {
  kind: FurnitureKind;
  height: number;
  rotationY: number;
}

export interface CityVehicle extends Point {
  /** Length runs along local z. */
  rotationY: number;
  kind: "taxi" | "car" | "van";
}

export interface CityPlaza extends CityRect {
  /** The paved bow-tie; the rest of the island is two planted beds. */
  outline: Point[];
  beds: Point[][];
}

export interface CityLayout extends MapLayout {
  plaza: CityPlaza;
  blocks: CityBlock[];
  /** Lawns inside a block's sidewalk, planted with trees. */
  parks: CityRect[];
  buildings: CityBuilding[];
  /** Axis-aligned strips of roadway; they overlap at junctions. */
  roads: CityRect[];
  screens: CityPanel[];
  tickers: CityPanel[];
  furniture: CityFurniture[];
  lamps: Point[];
  vehicles: CityVehicle[];
  trees: TownTree[];
}

type Cell = [i: number, j: number];

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// A building lot and which of its walls face the sidewalk (the others face a neighbour).
interface Lot extends Rect {
  open: { north: boolean; south: boolean; east: boolean; west: boolean };
}

// Ring 1 in the order districts claim it: the north row and the two ends first, which are
// the screen buildings, so a 5-district city is symmetric about the plaza.
const RING_ONE: Cell[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  [0, 1],
];

// Outer rings run clockwise from due north.
function ring(r: number): Cell[] {
  if (r === 1) return RING_ONE;
  const cells: Cell[] = [];
  for (let i = 0; i <= r; i++) cells.push([i, -r]);
  for (let j = -r + 1; j <= r; j++) cells.push([r, j]);
  for (let i = r - 1; i >= -r; i--) cells.push([i, r]);
  for (let j = r - 1; j >= -r; j--) cells.push([-r, j]);
  for (let i = -r + 1; i < 0; i++) cells.push([i, -r]);
  return cells;
}

const rectOf = (r: Rect): CityRect => ({
  x: (r.minX + r.maxX) / 2,
  z: (r.minZ + r.maxZ) / 2,
  width: r.maxX - r.minX,
  depth: r.maxZ - r.minZ,
});

export function layoutCity(homeCount: number, neighbourhoodCount: number): CityLayout {
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
  const random = seededRandom(Math.imul(homeCount, 0x27d4eb2d) ^ Math.imul(n, 0x165667b1));

  const baseArea = PLAZA_X * PLAZA_Z * (1 - NOTCH);
  const scale = Math.max(1, Math.sqrt((homeCount * PLAZA_AREA_PER_HOME) / baseArea));
  const plazaX = PLAZA_X * scale;
  const plazaZ = PLAZA_Z * scale;

  // Column i spans x, row j spans z; the middle ones hold the plaza.
  const span = (k: number, middle: number, block: number): [number, number] => {
    if (k === 0) return [-middle / 2, middle / 2];
    const lo = middle / 2 + ROAD + (Math.abs(k) - 1) * (block + ROAD);
    return k > 0 ? [lo, lo + block] : [-(lo + block), -lo];
  };
  const cellRect = ([i, j]: Cell): Rect => {
    const [minX, maxX] = span(i, plazaX, BLOCK_X);
    const [minZ, maxZ] = span(j, plazaZ, BLOCK_Z);
    return { minX, maxX, minZ, maxZ };
  };
  const lotsOf = (cell: Cell): Lot[] => {
    const r = cellRect(cell);
    const inner = {
      minX: r.minX + SIDEWALK,
      maxX: r.maxX - SIDEWALK,
      minZ: r.minZ + SIDEWALK,
      maxZ: r.maxZ - SIDEWALK,
    };
    const all = { north: true, south: true, east: true, west: true };
    // The tower north of the plaza is one building, a wall of screens.
    if (cell[0] === 0 && cell[1] === -1) return [{ ...inner, open: all }];
    const mid = (inner.minX + inner.maxX) / 2;
    return [
      { ...inner, maxX: mid - BUILDING_GAP / 2, open: { ...all, east: false } },
      { ...inner, minX: mid + BUILDING_GAP / 2, open: { ...all, west: false } },
    ];
  };

  // Districts claim whole blocks in ring order until their doors fit their homes.
  const order: Cell[] = [];
  const nextCell = (): Cell => {
    if (order.length === 0) order.push(...ring(1));
    const cell = order.shift() as Cell;
    if (order.length === 0) order.push(...ring(Math.max(Math.abs(cell[0]), Math.abs(cell[1])) + 1));
    return cell;
  };
  const owner = new Map<string, number>();
  const key = ([i, j]: Cell) => `${i},${j}`;
  const districtCells: Cell[][] = sizes.map((size, k) => {
    const cells: Cell[] = [];
    let doors = 0;
    do {
      const cell = nextCell();
      owner.set(key(cell), k);
      cells.push(cell);
      doors += lotsOf(cell).reduce((sum, lot) => sum + doorSlots(lot).length, 0);
    } while (doors < size);
    return cells;
  });
  const rings = Math.max(
    1,
    ...districtCells.flat().map(([i, j]) => Math.max(Math.abs(i), Math.abs(j))),
  );

  const blocks: CityBlock[] = [];
  const buildings: CityBuilding[] = [];
  const parks: CityRect[] = [];
  const parkTrees: TownTree[] = [];
  const lamps: Point[] = [];
  const slotsByCell = new Map<string, { door: Point; facing: number }[]>();
  for (let r = 1; r <= rings; r++) {
    for (const cell of ring(r)) {
      const [i, j] = cell;
      const district = owner.get(key(cell)) ?? -1;
      const area = cellRect(cell);
      blocks.push({ ...rectOf(area), neighbourhood: district });
      for (const [x, z] of [
        [area.minX, area.minZ],
        [area.maxX, area.minZ],
        [area.minX, area.maxZ],
        [area.maxX, area.maxZ],
      ]) {
        lamps.push({
          x: x === area.minX ? x + LAMP_INSET : x - LAMP_INSET,
          z: z === area.minZ ? z + LAMP_INSET : z - LAMP_INSET,
        });
      }
      const slots: { door: Point; facing: number }[] = [];
      slotsByCell.set(key(cell), slots);
      // Unless a district needs it, the block south of the plaza is a park, which keeps the
      // default camera's view of the plaza open.
      if (district < 0 && i === 0 && j === 1) {
        const lawn = {
          minX: area.minX + SIDEWALK,
          maxX: area.maxX - SIDEWALK,
          minZ: area.minZ + SIDEWALK,
          maxZ: area.maxZ - SIDEWALK,
        };
        parks.push(rectOf(lawn));
        parkTrees.push(...grove(lawn, random));
        continue;
      }
      const kind: BuildingKind = district >= 0 ? "apartments" : j > 0 ? "shops" : "offices";
      lotsOf(cell).forEach((lot) => {
        const height = heightFor(i, j, r, random);
        // Screens need a flat wall, so the buildings round the plaza don't step in.
        const screened = r === 1 && j <= 0;
        const podium = !screened && height >= 14 ? 6 + random() * 2 : height;
        buildings.push({ ...rectOf(lot), height, podium, kind });
        if (kind === "apartments") slots.push(...doorSlots(lot));
      });
    }
  }

  // Each district spreads its homes evenly over its doors, home j * n + k taking slot j.
  const homes: MapHome[] = new Array(homeCount);
  districtCells.forEach((cells, k) => {
    const slots = cells.flatMap((cell) => slotsByCell.get(key(cell)) ?? []);
    for (let j = 0; j < sizes[k]; j++) {
      const slot = slots[Math.floor((j * slots.length) / sizes[k])];
      homes[j * n + k] = {
        index: j * n + k,
        neighbourhood: k,
        door: slot.door,
        facing: slot.facing,
      };
    }
  });

  const plaza = layoutPlaza(plazaX, plazaZ);
  const screens: CityPanel[] = [];
  const tickers: CityPanel[] = [];
  placeScreens(lotsOf, screens, tickers);

  const extent = {
    minX: cellRect([-rings, 0]).minX - ROAD,
    maxX: cellRect([rings, 0]).maxX + ROAD,
    minZ: cellRect([0, -rings]).minZ - ROAD,
    maxZ: cellRect([0, rings]).maxZ + ROAD,
  };
  const roads = layoutRoads(rings, cellRect, extent);
  const vehicles = parkVehicles([...blocks, plaza.island], random);
  const trees = [...parkTrees, ...plantTrees(plaza, extent, random)];

  const neighbourhoods = districtCells.map((cells, k) => {
    const centres = cells.map((c) => rectOf(cellRect(c)));
    return {
      index: k,
      homeCount: sizes[k],
      centre: {
        x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
        z: centres.reduce((s, c) => s + c.z, 0) / centres.length,
      },
    };
  });

  const height = Math.max(...buildings.map((b) => b.height)) + ROOFTOP;
  const frame = [
    ...buildings.flatMap((b) =>
      [-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => ({
          x: b.x + (sx * b.width) / 2,
          y: b.height,
          z: b.z + (sz * b.depth) / 2,
        })),
      ),
    ),
    { x: extent.minX, y: 0, z: extent.minZ },
    { x: extent.maxX, y: 0, z: extent.minZ },
    { x: extent.minX, y: 0, z: extent.maxZ },
    { x: extent.maxX, y: 0, z: extent.maxZ },
  ];
  const casters: Disc[] = [
    ...buildings.map((b) => ({ x: b.x, z: b.z, radius: Math.hypot(b.width, b.depth) / 2 })),
    ...trees.map((t) => ({ x: t.x, z: t.z, radius: TREE_RADIUS * t.size })),
    ...vehicles.map((v) => ({ x: v.x, z: v.z, radius: VEHICLE_LENGTH / 2 })),
    ...lamps.map((l) => ({ ...l, radius: 0.5 })),
  ];

  return {
    homes,
    neighbourhoods,
    gathering: plaza.gathering,
    bounds: extent,
    roam: "box",
    frame,
    casters,
    height,
    plaza: plaza.island,
    blocks,
    parks,
    buildings,
    roads,
    screens,
    tickers,
    furniture: plaza.furniture,
    lamps: [...lamps, ...plaza.lamps],
    vehicles,
    trees,
  };
}

// Tall to the north, where the screens are; low to the south, where the camera looks over.
function heightFor(i: number, j: number, ring: number, random: () => number): number {
  if (i === 0 && j === -1) return 30;
  if (j > 0) return 5 + random() * 3;
  if (ring === 1) return j < 0 ? 20 + random() * 8 : 14 + random() * 8;
  return 8 + random() * 8;
}

// Door slots along a lot's walls that face the sidewalk, evenly spaced, clear of corners.
function doorSlots(lot: Lot): { door: Point; facing: number }[] {
  const walls = [
    { open: lot.open.south, from: [lot.minX, lot.maxZ], to: [lot.maxX, lot.maxZ], facing: 0 },
    {
      open: lot.open.east,
      from: [lot.maxX, lot.maxZ],
      to: [lot.maxX, lot.minZ],
      facing: Math.PI / 2,
    },
    { open: lot.open.north, from: [lot.maxX, lot.minZ], to: [lot.minX, lot.minZ], facing: Math.PI },
    {
      open: lot.open.west,
      from: [lot.minX, lot.minZ],
      to: [lot.minX, lot.maxZ],
      facing: -Math.PI / 2,
    },
  ];
  return walls.flatMap(({ open, from, to, facing }) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (!open || length < 2 * DOOR_CORNER) return [];
    const count = Math.floor((length - 2 * DOOR_CORNER) / DOOR_SPACING) + 1;
    return Array.from({ length: count }, (_, k) => {
      const t =
        count === 1 ? 0.5 : (DOOR_CORNER + (k * (length - 2 * DOOR_CORNER)) / (count - 1)) / length;
      return {
        door: { x: from[0] + (to[0] - from[0]) * t, z: from[1] + (to[1] - from[1]) * t },
        facing,
      };
    });
  });
}

// The bow-tie, its beds, furniture and lamps, and where blobs can stand on it.
function layoutPlaza(width: number, depth: number) {
  const halfX = width / 2;
  const halfZ = depth / 2;
  const notch = NOTCH * depth;
  const outline: Point[] = [
    { x: -halfX, z: -halfZ },
    { x: 0, z: -halfZ + notch },
    { x: halfX, z: -halfZ },
    { x: halfX, z: halfZ },
    { x: 0, z: halfZ - notch },
    { x: -halfX, z: halfZ },
  ];
  const beds = [
    [outline[0], outline[2], outline[1]],
    [outline[3], outline[5], outline[4]],
  ];
  // Where the north and south edges of the paving are, |x| from the middle.
  const north = (x: number) => -halfZ + notch * (1 - Math.abs(x) / halfX);
  const south = (x: number) => halfZ - notch * (1 - Math.abs(x) / halfX);

  const furniture: CityFurniture[] = [];
  const add = (kind: FurnitureKind, x: number, z: number, w: number, d: number, h: number) =>
    furniture.push({ kind, x, z, width: w, depth: d, height: h, rotationY: 0 });
  for (const side of [-1, 1]) {
    // Bleacher steps in the south half, facing the screens to the north.
    const stepsX = side * width * 0.27;
    const inner = Math.abs(stepsX) - 4.5;
    add("steps", stepsX, south(inner) - 0.8 - 2.1, 9, 4.2, 1.8);
    add("kiosk", side * (halfX - 3.2), -halfZ + 3.2, 2.6, 2.6, 2.6);
    for (const at of [0.14, 0.32]) {
      const x = side * width * at;
      add("bench", x, north(Math.abs(x) - 1.5) + 1.4, 3, 0.8, 0.9);
    }
    add("planter", side * (halfX - 1.6), halfZ - 1.6, 1.8, 1.8, 0.9);
    add("planter", side * 2.5, north(2.5 - 0.8) + 1.6, 1.6, 1.6, 0.9);
  }
  const lamps: Point[] = [-0.42, -0.1, 0.1, 0.42].map((at) => ({ x: at * width, z: 0 }));
  const obstacles: Obstacle[] = [
    ...furniture.map(({ x, z, width, depth, rotationY }) => ({
      kind: "box" as const,
      ...{ x, z, width, depth, rotationY },
    })),
    ...lamps.map((l) => ({ kind: "disc" as const, ...l, radius: 0.3 })),
  ];

  return {
    island: { x: 0, z: 0, width, depth, outline, beds },
    gathering: { outline, spots: standingSpots(outline, obstacles) },
    furniture,
    lamps,
  };
}

// Big screens on the buildings round the plaza, and a news ticker on the tower. Only walls
// the default camera can see get one: the tower to the north, its neighbours either side,
// and the corners of the two buildings at the plaza's ends.
function placeScreens(lotsOf: (cell: Cell) => Lot[], screens: CityPanel[], tickers: CityPanel[]) {
  const [tower] = lotsOf([0, -1]);
  const towerWidth = tower.maxX - tower.minX;
  const front = tower.maxZ + SCREEN_OFF_WALL;
  const mainW = Math.min(towerWidth * 0.7, 24);
  const mainH = mainW * 0.42;
  screens.push({
    x: (tower.minX + tower.maxX) / 2,
    y: SCREEN_BOTTOM + mainH / 2,
    z: front,
    width: mainW,
    height: mainH,
    rotationY: 0,
  });
  const tickerY = SCREEN_BOTTOM + mainH + 1.1;
  tickers.push({
    x: (tower.minX + tower.maxX) / 2,
    y: tickerY,
    z: front,
    width: towerWidth,
    height: 1,
    rotationY: 0,
  });
  const crownW = mainW * 0.55;
  const crownH = crownW * 0.5;
  screens.push({
    x: (tower.minX + tower.maxX) / 2,
    y: tickerY + 1.1 + crownH / 2,
    z: front,
    width: crownW,
    height: crownH,
    rotationY: 0,
  });

  // The lots of the north corners nearest the plaza: the east one to the west, and so on.
  for (const side of [-1, 1]) {
    const lots = lotsOf([side, -1]);
    const lot = side < 0 ? lots[1] : lots[0];
    const w = (lot.maxX - lot.minX) * 0.8;
    const h = w * 0.6;
    screens.push({
      x: (lot.minX + lot.maxX) / 2,
      y: SCREEN_BOTTOM + h / 2,
      z: lot.maxZ + SCREEN_OFF_WALL,
      width: w,
      height: h,
      rotationY: 0,
    });
  }

  // The ends: wrapped round the corner nearest both the plaza and the camera, facing
  // between them, so the camera never sees them edge-on.
  for (const side of [-1, 1]) {
    const lots = lotsOf([side, 0]);
    const lot = side < 0 ? lots[1] : lots[0];
    const corner = { x: side < 0 ? lot.maxX : lot.minX, z: lot.maxZ };
    const facing = -side * (Math.PI / 4);
    const w = (lot.maxZ - lot.minZ) * 0.5;
    const h = w * 0.6;
    screens.push({
      x: corner.x + Math.sin(facing) * SCREEN_OFF_WALL,
      y: SCREEN_BOTTOM + 0.5 + h / 2,
      z: corner.z + Math.cos(facing) * SCREEN_OFF_WALL,
      width: w,
      height: h,
      rotationY: facing,
    });
  }
}

// One strip of roadway in every gap between columns and rows, and round the outside.
function layoutRoads(rings: number, cellRect: (cell: Cell) => Rect, extent: Rect): CityRect[] {
  const roads: CityRect[] = [];
  for (let k = -rings; k <= rings + 1; k++) {
    // The road on the west side of column k, and on the north side of row k.
    const west = k <= rings ? cellRect([k, 0]).minX : cellRect([rings, 0]).maxX + ROAD;
    const north = k <= rings ? cellRect([0, k]).minZ : cellRect([0, rings]).maxZ + ROAD;
    roads.push(rectOf({ minX: west - ROAD, maxX: west, minZ: extent.minZ, maxZ: extent.maxZ }));
    roads.push(rectOf({ minX: extent.minX, maxX: extent.maxX, minZ: north - ROAD, maxZ: north }));
  }
  return roads;
}

// Now and then a parked car along a kerb, clear of the junctions and of each other.
function parkVehicles(kerbs: CityRect[], random: () => number): CityVehicle[] {
  const vehicles: CityVehicle[] = [];
  for (const b of kerbs) {
    const sides = [
      {
        along: "x",
        fixed: b.z - b.depth / 2 - 0.3 - VEHICLE_WIDTH / 2,
        from: b.x - b.width / 2,
        to: b.x + b.width / 2,
      },
      {
        along: "x",
        fixed: b.z + b.depth / 2 + 0.3 + VEHICLE_WIDTH / 2,
        from: b.x - b.width / 2,
        to: b.x + b.width / 2,
      },
      {
        along: "z",
        fixed: b.x - b.width / 2 - 0.3 - VEHICLE_WIDTH / 2,
        from: b.z - b.depth / 2,
        to: b.z + b.depth / 2,
      },
      {
        along: "z",
        fixed: b.x + b.width / 2 + 0.3 + VEHICLE_WIDTH / 2,
        from: b.z - b.depth / 2,
        to: b.z + b.depth / 2,
      },
    ];
    for (const side of sides) {
      const lo = side.from + PARK_CLEAR + VEHICLE_LENGTH / 2;
      const hi = side.to - PARK_CLEAR - VEHICLE_LENGTH / 2;
      if (hi < lo || random() > 0.3) continue;
      const at = lo + random() * (hi - lo);
      const roll = random();
      const kind = roll < 0.5 ? "taxi" : roll < 0.85 ? "car" : "van";
      const turn = random() < 0.5 ? 0 : Math.PI;
      vehicles.push(
        side.along === "x"
          ? { x: at, z: side.fixed, rotationY: turn + Math.PI / 2, kind }
          : { x: side.fixed, z: at, rotationY: turn, kind },
      );
    }
  }
  return vehicles;
}

// Two loose rows of trees across a park lawn, a little jitter so they don't look planted
// by a machine.
function grove(lawn: Rect, random: () => number): TownTree[] {
  const trees: TownTree[] = [];
  const width = lawn.maxX - lawn.minX;
  const depth = lawn.maxZ - lawn.minZ;
  const columns = Math.max(1, Math.floor((width - 4) / 5));
  for (const row of [0.3, 0.7]) {
    for (let c = 0; c < columns; c++) {
      trees.push({
        x: lawn.minX + 2 + ((c + 0.5) * (width - 4)) / columns + (random() - 0.5),
        z: lawn.minZ + row * depth + (random() - 0.5),
        size: 0.85 + random() * 0.25,
      });
    }
  }
  return trees;
}

// Trees in the plaza's beds and a seeded scatter in the fields round the city.
function plantTrees(
  plaza: ReturnType<typeof layoutPlaza>,
  extent: Rect,
  random: () => number,
): TownTree[] {
  const { width, depth } = plaza.island;
  const notch = NOTCH * depth;
  const trees: TownTree[] = [];
  for (const side of [-1, 1]) {
    for (const x of [-0.26, 0, 0.26]) {
      const bedDepth = notch * (1 - Math.abs(x) * 2);
      trees.push({ x: x * width, z: side * (depth / 2 - bedDepth / 2), size: 0.8 });
    }
  }
  const inner = {
    minX: extent.minX - 3,
    maxX: extent.maxX + 3,
    minZ: extent.minZ - 3,
    maxZ: extent.maxZ + 3,
  };
  const outerW = extent.maxX - extent.minX + 2 * (3 + TREE_BELT);
  const outerD = extent.maxZ - extent.minZ + 2 * (3 + TREE_BELT);
  const wanted = Math.round(
    TREE_DENSITY * (outerW * outerD - (inner.maxX - inner.minX) * (inner.maxZ - inner.minZ)),
  );
  const start = trees.length;
  for (let tries = 0; tries < wanted * 30 && trees.length - start < wanted; tries++) {
    const tree = {
      x: inner.minX - TREE_BELT + random() * outerW,
      z: inner.minZ - TREE_BELT + random() * outerD,
      size: 0.7 + random() * 0.5,
    };
    const reach = TREE_RADIUS * tree.size;
    const inCity =
      tree.x > inner.minX - reach &&
      tree.x < inner.maxX + reach &&
      tree.z > inner.minZ - reach &&
      tree.z < inner.maxZ + reach;
    const crowded = trees.some(
      (t) => Math.hypot(t.x - tree.x, t.z - tree.z) < reach + TREE_RADIUS * t.size + 0.6,
    );
    if (!inCity && !crowded) trees.push(tree);
  }
  return trees;
}

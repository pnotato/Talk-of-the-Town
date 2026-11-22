// Pure, deterministic city layout: plain data in world units (an adult blob is ~1 tall).
// No three.js, DOM, Math.random or clock, so the same counts always give the same city.
//
// A grid of blocks with a plaza island in the middle cell, every block ringed by a sidewalk
// and every gap a road, crossed by a zebra where it leaves a junction. The plaza is an open
// square of paving, a kiosk in each of its north corners. Districts (neighbourhoods) take whole
// blocks of apartment buildings, one door per home onto the sidewalk; the other blocks are
// offices and shops. Big screens on the buildings round the plaza face into it and towards the
// default camera, which looks north from the south.
//
// Blobs can walk and stand on the plaza, the park south of it, and the sidewalks of every block
// across a road from it (the gathering's areas), never on a road.
import { TREE_HEIGHT, TREE_RADIUS, type TownTree } from "./layoutTown.ts";
import {
  BLOB_RADIUS,
  BLOB_REACH,
  type Disc,
  type Solid,
  type MapHome,
  type MapLayout,
  type Obstacle,
  type Point,
  seededRandom,
  SPOT_SPACING,
  standingSpots,
  type WalkArea,
} from "./mapLayout.ts";

// docs/MODEL.md: 53 homes dealt round-robin into 5 neighbourhoods.
export const CITY_HOMES = 53;
export const CITY_NEIGHBOURHOODS = 5;

export const ROAD = 7; // two 3.5 lanes
export const SIDEWALK = 2.5; // the paved edge of every block, inside its rectangle
export const VEHICLE_LENGTH = 4.2;
export const VEHICLE_WIDTH = 1.9;
export const SETBACK = 1.5; // how far a tall building's upper floors step in
export const DOOR_WIDTH = 1.1;
/** Blobs keep their reach from a doorstep this deep in front of every door, so none blocks it. */
export const DOORSTEP = 1;
/** Depth of a zebra crossing along its road. */
export const CROSSWALK = 2.4;
/** A zebra crossing starts this far out from the junction it leaves. */
export const CROSSWALK_GAP = 0.6;

const BLOCK_X = 24;
const BLOCK_Z = 18;
const PLAZA_X = 46;
const PLAZA_Z = 24;
// The plaza grows past its base size so there are standing spots for 2 blobs per home.
const PLAZA_AREA_PER_HOME = 10;
const BUILDING_GAP = 1;
const DOOR_SPACING = 3;
const DOOR_CORNER = 2; // doors keep this far from a building's corners, and so from each other round one
const SCREEN_BOTTOM = 4; // above the doors and their canopies
const SCREEN_OFF_WALL = 0.15;
const ROOFTOP = 2; // headroom for water tanks and plant on the roofs
const LAMP_INSET = 0.8;
const LAMP_RADIUS = 0.3; // what of a lamp post a blob must keep its reach from
const PARK_CLEAR = 3.5; // parked cars keep clear of junctions and their crosswalks
const PARK_EDGE = 1.8; // park trees stand this far in from the lawn's long edges
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

/** A flat panel facing its local +z, on or off a wall. */
export interface CityPanel extends Point {
  y: number; // centre height
  width: number;
  height: number;
  rotationY: number;
}

/** A screen, and the kind of placeholder it shows until real content plugs in. */
export interface ScreenPanel extends CityPanel {
  content: "news" | "ad";
}

/**
 * A strip of news ticker. Strips that wrap a corner share a run: `run` is how far along it
 * this strip starts, so the scrolling text carries on round the corner.
 */
export interface TickerStrip extends CityPanel {
  run: number;
}

export type FurnitureKind = "kiosk";

/** Plaza furniture. */
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

/** A zebra crossing: a strip across a road, kerb to kerb, CROSSWALK deep. */
export interface CityCrosswalk extends CityRect {
  /** The way a pedestrian walks over it. */
  axis: "x" | "z";
}

/** Something a blob walking the city must go round, and what it is. */
export interface CityObstacle {
  what: "lamp" | "tree" | "building" | FurnitureKind;
  obstacle: Obstacle;
}

export interface CityPlaza extends CityRect {
  /** The paving: the whole island, as a rectangle. */
  outline: Point[];
}

export interface CityLayout extends MapLayout {
  plaza: CityPlaza;
  blocks: CityBlock[];
  /** Lawns inside a block's sidewalk, planted with trees. */
  parks: CityRect[];
  buildings: CityBuilding[];
  /** Axis-aligned strips of roadway; they overlap at junctions. */
  roads: CityRect[];
  /** Road by road, and along each road from its near end. */
  crosswalks: CityCrosswalk[];
  screens: ScreenPanel[];
  tickers: TickerStrip[];
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

  const baseArea = PLAZA_X * PLAZA_Z;
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
  // The blocks across a road from the plaza, whose sidewalks blobs can walk; walled unless a park.
  const plazaBlocks: { rect: Rect; walled: boolean }[] = [];
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
        if (r === 1) plazaBlocks.push({ rect: area, walled: false });
        continue;
      }
      if (r === 1) plazaBlocks.push({ rect: area, walled: true });
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
  const screens: ScreenPanel[] = [];
  const tickers: TickerStrip[] = [];
  placeScreens(lotsOf, screens, tickers);

  const extent = {
    minX: cellRect([-rings, 0]).minX - ROAD,
    maxX: cellRect([rings, 0]).maxX + ROAD,
    minZ: cellRect([0, -rings]).minZ - ROAD,
    maxZ: cellRect([0, rings]).maxZ + ROAD,
  };
  const roads = layoutRoads(rings, cellRect, extent);
  const crosswalks = layoutCrosswalks(roads, extent);
  const vehicles = parkVehicles(
    [...blocks.map((rect) => ({ rect, busy: false })), { rect: plaza.island, busy: true }],
    random,
  );
  queueAtCrossings(plaza.island, vehicles, random);
  const trees = [...parkTrees, ...plantTrees(extent, random)];
  const lampPosts = [...lamps, ...plaza.lamps];
  const walking = walkingObstacles({
    lamps: lampPosts,
    trees,
    buildings,
    furniture: plaza.furniture,
  });
  // A standing blob also keeps clear of every doorstep, which a walking one may cross.
  const gathering = walkableAreas(plaza, parks, plazaBlocks, [
    ...walking.map((o) => o.obstacle),
    ...homes.map((h) => ({
      kind: "box" as const,
      x: h.door.x + (Math.sin(h.facing) * DOORSTEP) / 2,
      z: h.door.z + (Math.cos(h.facing) * DOORSTEP) / 2,
      width: DOOR_WIDTH,
      depth: DOORSTEP,
      rotationY: h.facing,
    })),
  ]);

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

  // Everything the camera must keep out of: buildings, screens that hang out past their
  // walls, trees and kiosks (a camera inside a canopy looks as wrong as inside a tower).
  const BEZEL_DEPTH = 0.4;
  const solids: Solid[] = [
    ...buildings.map((b) => ({
      x: b.x,
      z: b.z,
      width: b.width,
      depth: b.depth,
      rotationY: 0,
      height: b.height,
    })),
    ...[...screens, ...tickers].map((p) => ({
      x: p.x,
      z: p.z,
      width: p.width,
      depth: BEZEL_DEPTH,
      rotationY: p.rotationY,
      height: p.y + p.height / 2,
    })),
    ...trees.map((t) => {
      const span = 2 * TREE_RADIUS * t.size;
      return {
        x: t.x,
        z: t.z,
        width: span,
        depth: span,
        rotationY: 0,
        height: TREE_HEIGHT * t.size,
      };
    }),
    ...plaza.furniture
      .filter((f) => f.kind === "kiosk")
      .map((f) => ({
        x: f.x,
        z: f.z,
        width: f.width + 0.8,
        depth: f.depth + 0.8,
        rotationY: 0,
        height: f.height + 0.4,
      })),
  ];

  return {
    homes,
    neighbourhoods,
    gathering,
    bounds: extent,
    roam: "box",
    frame,
    casters,
    solids,
    height,
    plaza: plaza.island,
    blocks,
    parks,
    buildings,
    roads,
    crosswalks,
    screens,
    tickers,
    furniture: plaza.furniture,
    lamps: lampPosts,
    vehicles,
    trees,
  };
}

/**
 * What a blob walking the city must go round: lamp posts, tree canopies, building walls and
 * plaza furniture, in that order. Not doorsteps: a blob may walk past a door, it just never
 * stands in front of one.
 */
export function walkingObstacles(
  city: Pick<CityLayout, "lamps" | "trees" | "buildings" | "furniture">,
): CityObstacle[] {
  const box = ({ x, z, width, depth }: CityRect, rotationY: number): Obstacle => ({
    kind: "box",
    ...{ x, z, width, depth, rotationY },
  });
  return [
    ...city.lamps.map(({ x, z }): CityObstacle => ({
      what: "lamp",
      obstacle: { kind: "disc", x, z, radius: LAMP_RADIUS },
    })),
    ...city.trees.map(({ x, z, size }): CityObstacle => ({
      what: "tree",
      obstacle: { kind: "disc", x, z, radius: TREE_RADIUS * size },
    })),
    ...city.buildings.map((b): CityObstacle => ({ what: "building", obstacle: box(b, 0) })),
    ...city.furniture.map((f): CityObstacle => ({ what: f.kind, obstacle: box(f, f.rotationY) })),
  ];
}

// A canyon round the plaza, tallest at the news tower; low to the south, where the default
// camera looks over; lower again further out.
function heightFor(i: number, j: number, ring: number, random: () => number): number {
  if (i === 0 && j === -1) return 44;
  if (j > 0) return 5 + random() * 3;
  // Stepped: the ends lower than the corners behind them, whose screens show over them.
  if (ring === 1) return j < 0 ? 34 + random() * 8 : 22 + random() * 6;
  return j < 0 ? 12 + random() * 8 : 8 + random() * 6;
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

// The plaza: open paving edge to edge, a kiosk in each north corner and a lamp in every corner,
// like the blocks round it. The middle is left clear for the crowd.
function layoutPlaza(width: number, depth: number) {
  const halfX = width / 2;
  const halfZ = depth / 2;
  const outline: Point[] = [
    { x: -halfX, z: -halfZ },
    { x: halfX, z: -halfZ },
    { x: halfX, z: halfZ },
    { x: -halfX, z: halfZ },
  ];
  const furniture: CityFurniture[] = [-1, 1].map((side) => ({
    kind: "kiosk",
    x: side * (halfX - 3.2),
    z: -halfZ + 3.2,
    width: 2.6,
    depth: 2.6,
    height: 2.6,
    rotationY: 0,
  }));
  const lamps = outline.map((p) => ({
    x: p.x - Math.sign(p.x) * LAMP_INSET,
    z: p.z - Math.sign(p.z) * LAMP_INSET,
  }));
  return { island: { x: 0, z: 0, width, depth, outline }, furniture, lamps };
}

// Where blobs can walk and stand: the plaza first, then the parks, then the four strips of
// sidewalk round each block across a road from the plaza. Every cell keeps a blob's reach
// from the obstacles. Where two areas meet (a park's lawn and its sidewalk), the earlier keeps
// its cells and the later drops any closer than the spacing, so neighbours never crowd.
function walkableAreas(
  plaza: ReturnType<typeof layoutPlaza>,
  parks: CityRect[],
  blocks: { rect: Rect; walled: boolean }[],
  obstacles: Obstacle[],
): { areas: WalkArea[] } {
  const area = (name: string, r: Rect, anchor?: Point): WalkArea => {
    const outline = [
      { x: r.minX, z: r.minZ },
      { x: r.maxX, z: r.minZ },
      { x: r.maxX, z: r.maxZ },
      { x: r.minX, z: r.maxZ },
    ];
    return { name, outline, spots: standingSpots(outline, obstacles, anchor) };
  };
  const { outline } = plaza.island;
  const areas: WalkArea[] = [
    { name: "plaza", outline, spots: standingSpots(outline, obstacles) },
    ...parks.map((p) =>
      area("park", {
        minX: p.x - p.width / 2,
        maxX: p.x + p.width / 2,
        minZ: p.z - p.depth / 2,
        maxZ: p.z + p.depth / 2,
      }),
    ),
    ...blocks.flatMap(({ rect, walled }) =>
      sidewalkStrips(rect, walled).map((strip) => area("sidewalk", strip, strip.anchor)),
    ),
  ];
  const kept: Point[] = [];
  for (const a of areas) {
    a.spots = a.spots.filter((p) =>
      kept.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= SPOT_SPACING - 1e-9),
    );
    kept.push(...a.spots);
  }
  return { areas };
}

// A block's sidewalk as four strips that don't overlap: north and south the block's full
// width, east and west between them. A strip is one cell wide, so its grid runs through where
// cells fit best: centred between a blob's radius off the kerb and its reach off the walls (or
// its radius off a park's lawn). Along an east or west strip the cells zigzag in two columns,
// half a spacing apart, either side of that line.
function sidewalkStrips(r: Rect, walled: boolean): (Rect & { anchor: Point })[] {
  const fromKerb = (BLOB_RADIUS + SIDEWALK - (walled ? BLOB_REACH : BLOB_RADIUS)) / 2;
  const zigzag = SPOT_SPACING / 4;
  const x = (r.minX + r.maxX) / 2;
  const z = (r.minZ + r.maxZ) / 2;
  const between = { minZ: r.minZ + SIDEWALK, maxZ: r.maxZ - SIDEWALK };
  return [
    { ...r, maxZ: r.minZ + SIDEWALK, anchor: { x, z: r.minZ + fromKerb } },
    { ...r, minZ: r.maxZ - SIDEWALK, anchor: { x, z: r.maxZ - fromKerb } },
    {
      ...between,
      minX: r.minX,
      maxX: r.minX + SIDEWALK,
      anchor: { x: r.minX + fromKerb - zigzag, z },
    },
    {
      ...between,
      minX: r.maxX - SIDEWALK,
      maxX: r.maxX,
      anchor: { x: r.maxX - fromKerb - zigzag, z },
    },
  ];
}

// One wall of a lot, for hanging panels on: where it starts, the way a panel's local +x runs
// along it, and how a panel on it faces (outwards).
interface Wall {
  start: Point;
  along: Point;
  length: number;
  rotationY: number;
}

function wall(lot: Rect, side: "north" | "south" | "east" | "west"): Wall {
  const w = lot.maxX - lot.minX;
  const d = lot.maxZ - lot.minZ;
  if (side === "south")
    return { start: { x: lot.minX, z: lot.maxZ }, along: { x: 1, z: 0 }, length: w, rotationY: 0 };
  if (side === "north")
    return {
      start: { x: lot.maxX, z: lot.minZ },
      along: { x: -1, z: 0 },
      length: w,
      rotationY: Math.PI,
    };
  if (side === "east")
    return {
      start: { x: lot.maxX, z: lot.maxZ },
      along: { x: 0, z: -1 },
      length: d,
      rotationY: Math.PI / 2,
    };
  return {
    start: { x: lot.minX, z: lot.minZ },
    along: { x: 0, z: 1 },
    length: d,
    rotationY: -Math.PI / 2,
  };
}

// A panel flat on a wall, `from` along it, its bottom `bottom` up.
function onWall(w: Wall, from: number, width: number, bottom: number, height: number): CityPanel {
  const at = from + width / 2;
  return {
    x: w.start.x + w.along.x * at + Math.sin(w.rotationY) * SCREEN_OFF_WALL,
    y: bottom + height / 2,
    z: w.start.z + w.along.z * at + Math.cos(w.rotationY) * SCREEN_OFF_WALL,
    width,
    height,
    rotationY: w.rotationY,
  };
}

// The plaza's wall of screens: news on the big ones, made-up ads on the rest, and tickers.
// Only walls the default camera can see get any: the news tower to the north, its two
// neighbours, and the two towers at the plaza's ends, whose plaza corners carry the
// corner screens and a ticker wrapped round them.
function placeScreens(
  lotsOf: (cell: Cell) => Lot[],
  screens: ScreenPanel[],
  tickers: TickerStrip[],
) {
  const news = (p: CityPanel) => screens.push({ ...p, content: "news" });
  const ad = (p: CityPanel) => screens.push({ ...p, content: "ad" });

  const [tower] = lotsOf([0, -1]);
  const face = wall(tower, "south");
  const W = face.length;
  const mainW = Math.min(W * 0.58, 24);
  const mainH = mainW * 0.42;
  const banner = { width: 3.2, height: 14, inset: 0.8 };
  news(onWall(face, (W - mainW) / 2, mainW, SCREEN_BOTTOM, mainH));
  // The ticker runs between the two tall banners at the tower's edges.
  const tickerFrom = banner.inset + banner.width + 0.8;
  const tickerBottom = SCREEN_BOTTOM + mainH + 0.6;
  tickers.push({ ...onWall(face, tickerFrom, W - 2 * tickerFrom, tickerBottom, 1), run: 0 });
  const crownW = mainW * 0.55;
  const crownH = crownW * 0.5;
  const crownBottom = tickerBottom + 1 + 0.8;
  const crownFrom = (W - crownW) / 2;
  news(onWall(face, crownFrom, crownW, crownBottom, crownH));
  ad(onWall(face, crownFrom - 1 - 7, 7, crownBottom, 4));
  ad(onWall(face, crownFrom + crownW + 1, 7, crownBottom, 4));
  for (const from of [banner.inset, W - banner.inset - banner.width]) {
    ad(onWall(face, from, banner.width, SCREEN_BOTTOM, banner.height));
    ad(onWall(face, from, banner.width, SCREEN_BOTTOM + banner.height + 0.8, 3));
  }
  // A big band higher up, so the screens climb the tower.
  const bandW = Math.min(W * 0.55, 22);
  ad(onWall(face, (W - bandW) / 2, bandW, crownBottom + crownH + 1.2, 8));

  // The north corners: the lots nearest the plaza, a wide panel under a tall banner, high
  // enough to show over the towers at the plaza's ends.
  const overEnds = 14;
  for (const side of [-1, 1]) {
    const lots = lotsOf([side, -1]);
    const front = wall(side < 0 ? lots[1] : lots[0], "south");
    ad(onWall(front, (front.length - 7.4) / 2, 7.4, overEnds, 4.4));
    ad(onWall(front, (front.length - 2.6) / 2, 2.6, overEnds + 5.2, 9));
  }

  // The ends: a wide panel and a tall banner on the wall facing the plaza, the corner
  // screen, and a ticker wrapped round that corner above it.
  for (const side of [-1, 1]) {
    const lots = lotsOf([side, 0]);
    const lot = side < 0 ? lots[1] : lots[0];
    const inward = wall(lot, side < 0 ? "east" : "west");
    const south = wall(lot, "south");
    const L = inward.length;
    // Measured from the plaza corner, which is where the east wall starts and the west ends.
    const fromCorner = (d: number, width: number) => (side < 0 ? d : L - d - width);
    ad(onWall(inward, fromCorner(6, 9), 9, SCREEN_BOTTOM, 5.2));
    ad(onWall(inward, fromCorner(L - 3, 2.8), 2.8, SCREEN_BOTTOM, 10));

    const corner = { x: side < 0 ? lot.maxX : lot.minX, z: lot.maxZ };
    const facing = -side * (Math.PI / 4);
    const w = (lot.maxZ - lot.minZ) * 0.5;
    const h = w * 0.6;
    news({
      x: corner.x + Math.sin(facing) * SCREEN_OFF_WALL,
      y: SCREEN_BOTTOM + 0.5 + h / 2,
      z: corner.z + Math.cos(facing) * SCREEN_OFF_WALL,
      width: w,
      height: h,
      rotationY: facing,
    });

    // Read left to right, the text reaches the corner on one wall and carries on round it.
    const bottom = SCREEN_BOTTOM + 0.5 + h + 1.2;
    const southLength = 6;
    const inwardLength = 9;
    const southStrip = onWall(
      south,
      side < 0 ? south.length - southLength : 0,
      southLength,
      bottom,
      1,
    );
    const inwardStrip = onWall(inward, fromCorner(0, inwardLength), inwardLength, bottom, 1);
    if (side < 0) {
      tickers.push({ ...southStrip, run: 0 }, { ...inwardStrip, run: southLength });
    } else {
      tickers.push({ ...inwardStrip, run: 0 }, { ...southStrip, run: inwardLength });
    }
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

/** The stretches of a road between the junctions along it, as [from, to] along its length. */
export function roadStretches(road: CityRect, roads: CityRect[]): [number, number][] {
  const vertical = road.depth > road.width;
  const along = (r: CityRect): [number, number] =>
    vertical ? [r.z - r.depth / 2, r.z + r.depth / 2] : [r.x - r.width / 2, r.x + r.width / 2];
  const junctions = roads
    .filter((r) => r.depth > r.width !== vertical)
    .map(along)
    .sort((a, b) => a[0] - b[0]);
  return junctions.slice(1).map(([from], k) => [junctions[k][1], from]);
}

// A zebra crossing across each road where it leaves a junction, but not on the outer ring
// road, which leads nowhere.
function layoutCrosswalks(roads: CityRect[], extent: Rect): CityCrosswalk[] {
  return roads.flatMap((road) => {
    const vertical = road.depth > road.width;
    const outer = vertical
      ? road.x - road.width / 2 <= extent.minX || road.x + road.width / 2 >= extent.maxX
      : road.z - road.depth / 2 <= extent.minZ || road.z + road.depth / 2 >= extent.maxZ;
    if (outer) return [];
    return roadStretches(road, roads).flatMap(([a, b]) =>
      [
        [a + CROSSWALK_GAP, a + CROSSWALK_GAP + CROSSWALK],
        [b - CROSSWALK_GAP - CROSSWALK, b - CROSSWALK_GAP],
      ].map(([from, to]): CityCrosswalk =>
        vertical
          ? { x: road.x, z: (from + to) / 2, width: road.width, depth: to - from, axis: "x" }
          : { x: (from + to) / 2, z: road.z, width: to - from, depth: road.depth, axis: "z" },
      ),
    );
  });
}

// Cars along the kerbs: now and then on a quiet street, nose to tail round the plaza and
// mostly taxis there. All clear of the junctions (and their crossings) and of each other.
function parkVehicles(
  kerbs: { rect: CityRect; busy: boolean }[],
  random: () => number,
): CityVehicle[] {
  const vehicles: CityVehicle[] = [];
  const pitch = VEHICLE_LENGTH + 1.5;
  for (const { rect: b, busy } of kerbs) {
    const out = 0.3 + VEHICLE_WIDTH / 2;
    const sides = [
      {
        along: "x",
        fixed: b.z - b.depth / 2 - out,
        from: b.x - b.width / 2,
        to: b.x + b.width / 2,
      },
      {
        along: "x",
        fixed: b.z + b.depth / 2 + out,
        from: b.x - b.width / 2,
        to: b.x + b.width / 2,
      },
      {
        along: "z",
        fixed: b.x - b.width / 2 - out,
        from: b.z - b.depth / 2,
        to: b.z + b.depth / 2,
      },
      {
        along: "z",
        fixed: b.x + b.width / 2 + out,
        from: b.z - b.depth / 2,
        to: b.z + b.depth / 2,
      },
    ];
    for (const side of sides) {
      const lo = side.from + PARK_CLEAR + VEHICLE_LENGTH / 2;
      const hi = side.to - PARK_CLEAR - VEHICLE_LENGTH / 2;
      if (hi < lo) continue;
      const spots = busy
        ? Array.from({ length: Math.floor((hi - lo) / pitch) + 1 }, (_, k) => lo + k * pitch)
        : [lo + random() * (hi - lo)];
      for (const at of spots) {
        if (random() > (busy ? 0.7 : 0.3)) continue;
        const roll = random();
        const kind = roll < (busy ? 0.75 : 0.5) ? "taxi" : roll < 0.88 ? "car" : "van";
        const turn = random() < 0.5 ? 0 : Math.PI;
        vehicles.push(
          side.along === "x"
            ? { x: at, z: side.fixed, rotationY: turn + Math.PI / 2, kind }
            : { x: side.fixed, z: at, rotationY: turn, kind },
        );
      }
    }
  }
  return vehicles;
}

// Footprint of a vehicle, which is only ever turned by a quarter.
function vehicleRect(v: CityVehicle): Rect {
  const turned = Math.abs(Math.sin(v.rotationY)) > 0.5;
  const w = (turned ? VEHICLE_LENGTH : VEHICLE_WIDTH) / 2;
  const d = (turned ? VEHICLE_WIDTH : VEHICLE_LENGTH) / 2;
  return { minX: v.x - w, maxX: v.x + w, minZ: v.z - d, maxZ: v.z + d };
}

// A car waiting at a crossing on each road round the plaza, in the lane away from it, nose
// just short of the crossing; dropped where a parked car is already in the way.
function queueAtCrossings(plaza: CityRect, vehicles: CityVehicle[], random: () => number) {
  const halfX = plaza.width / 2;
  const halfZ = plaza.depth / 2;
  const stop = CROSSWALK_GAP + CROSSWALK + 0.6 + VEHICLE_LENGTH / 2; // past the junction's crossing
  const lane = ROAD * 0.75;
  const waiting: CityVehicle[] = [];
  for (const side of [-1, 1]) {
    const dir = random() < 0.5 ? -1 : 1;
    // North and south of the plaza, driving east or west.
    waiting.push({
      x: dir * (halfX - stop),
      z: side * (halfZ + lane),
      rotationY: (dir * Math.PI) / 2,
      kind: random() < 0.6 ? "taxi" : "car",
    });
    // East and west of it, driving north or south.
    waiting.push({
      x: side * (halfX + lane),
      z: dir * (halfZ - stop),
      rotationY: dir > 0 ? 0 : Math.PI,
      kind: random() < 0.6 ? "taxi" : "car",
    });
  }
  for (const car of waiting) {
    const r = vehicleRect(car);
    const blocked = vehicles.some((v) => {
      const o = vehicleRect(v);
      return Math.max(o.minX - r.maxX, r.minX - o.maxX, o.minZ - r.maxZ, r.minZ - o.maxZ) < 0.5;
    });
    if (!blocked) vehicles.push(car);
  }
}

// Two loose rows of trees along a park lawn's long edges, leaving the middle open for blobs;
// a little jitter so they don't look planted by a machine. Every canopy stays on the lawn.
function grove(lawn: Rect, random: () => number): TownTree[] {
  const trees: TownTree[] = [];
  const width = lawn.maxX - lawn.minX;
  const depth = lawn.maxZ - lawn.minZ;
  const columns = Math.max(1, Math.floor((width - 4) / 5));
  for (const row of [PARK_EDGE, depth - PARK_EDGE]) {
    for (let c = 0; c < columns; c++) {
      trees.push({
        x: lawn.minX + 2 + ((c + 0.5) * (width - 4)) / columns + (random() - 0.5),
        z: lawn.minZ + row + (random() - 0.5),
        size: 0.85 + random() * 0.25,
      });
    }
  }
  return trees;
}

// A seeded scatter of trees in the fields round the city.
function plantTrees(extent: Rect, random: () => number): TownTree[] {
  const trees: TownTree[] = [];
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
  for (let tries = 0; tries < wanted * 30 && trees.length < wanted; tries++) {
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

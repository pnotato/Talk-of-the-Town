// The shape every map (the town, the city) hands to the scene: what the camera frames and
// roams, what the shadows cover, and what the blob replay needs to walk blobs between their
// homes and the gathering place. Plain data in world units (an adult blob is ~1 wide and
// ~1 tall); no three.js, so layouts stay pure and testable.

export interface Point {
  x: number;
  z: number;
}

export interface Disc extends Point {
  radius: number;
}

/** A rectangle turned about its centre; `width` runs along local x, `depth` along local z. */
export interface Box extends Point {
  width: number;
  depth: number;
  rotationY: number;
}

export type Obstacle = ({ kind: "disc" } & Disc) | ({ kind: "box" } & Box);

/** Something tall the camera must stay out of: a footprint and the height of its top. */
export interface Solid extends Box {
  height: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapHome {
  index: number;
  neighbourhood: number;
  /** Ground point at the middle of the home's front door. */
  door: Point;
  /** Turns local +z to point out of the door onto the street (three.js rotation.y). */
  facing: number;
}

export interface MapNeighbourhood {
  index: number;
  homeCount: number;
  centre: Point;
}

export interface MapGathering {
  /** The paved area where everyone gathers, as a simple (possibly concave) polygon. */
  outline: Point[];
  /** Where blobs can stand: inside the outline, clear of furniture, nearest the middle first. */
  spots: Point[];
}

export interface MapLayout {
  /** homes[i] belongs to neighbourhood i % neighbourhoods.length (dealt round-robin). */
  homes: MapHome[];
  neighbourhoods: MapNeighbourhood[];
  gathering: MapGathering;
  /** Where the camera's target may roam: this box, or the ellipse that fills it. */
  bounds: Bounds;
  roam: "box" | "ellipse";
  /** Points, with their height, that the default view must show. */
  frame: { x: number; y: number; z: number }[];
  /** Discs covering everything that casts a shadow. */
  casters: Disc[];
  /** Tall things the camera must never be inside; see cameraFloor. */
  solids: Solid[];
  /** Height of the tallest thing on the map. */
  height: number;
}

// A blob's standing room: spots sit on a hex grid this far apart, about 2.8 square units
// each. The widest blob (an elder) is 1.2 across, which leaves 0.6 between neighbours.
export const SPOT_SPACING = 1.8;
// A blob's feet stay this far inside the edge of where it stands.
export const BLOB_RADIUS = 0.6;
/**
 * How far from its spot any part of a blob can reach while it idles or holds a pose: an elder
 * star shaking in anger, or an elder square slumped forward, tips past its own radius.
 * Obstacles keep this far off, so nobody clips into a bench, a kiosk or the steps; two
 * neighbours reaching towards each other still leave a gap. blobReach.test.ts measures it.
 */
export const BLOB_REACH = 0.85;

/** Even-odd test, so concave outlines (a bow-tie) work. */
export function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = dx * dx + dz * dz;
  const t = length === 0 ? 0 : ((p.x - a.x) * dx + (p.z - a.z) * dz) / length;
  const k = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + k * dx), p.z - (a.z + k * dz));
}

export function distanceToOutline(p: Point, polygon: Point[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distanceToSegment(p, polygon[j], polygon[i]));
  }
  return best;
}

/** Shoelace area, whichever way the outline winds. */
export function polygonArea(polygon: Point[]): number {
  let twice = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    twice += polygon[j].x * polygon[i].z - polygon[i].x * polygon[j].z;
  }
  return Math.abs(twice) / 2;
}

/** Distance from a point to a turned box's edge; 0 inside it. */
export function distanceToBox(x: number, z: number, b: Box): number {
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  // Into the box's own axes (inverse of three's rotation.y).
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  const ox = Math.max(0, Math.abs(lx) - b.width / 2);
  const oz = Math.max(0, Math.abs(lz) - b.depth / 2);
  return Math.hypot(ox, oz);
}

/** Distance from a point to an obstacle's edge; 0 inside it. */
export function distanceToObstacle(p: Point, o: Obstacle): number {
  if (o.kind === "disc") return Math.max(0, Math.hypot(p.x - o.x, p.z - o.z) - o.radius);
  return distanceToBox(p.x, p.z, o);
}

// The camera keeps this far off any wall or roof, and this far off the ground.
export const CAMERA_MARGIN = 2;
export const GROUND_CLEARANCE = 2;
// Beyond the margin the floor eases down to the ground over this distance, so flying past
// a tower's edge lifts the camera smoothly instead of popping it up.
export const CAMERA_RAMP = 10;

/**
 * Lowest height the camera may be at above (x, z): a solid's top plus the margin while
 * within the margin of its footprint, easing down to ground clearance across the ramp.
 * Continuous everywhere, so a camera held at or above it moves without jumps. Allocates
 * nothing, so it can run every frame.
 */
export function cameraFloor(solids: Solid[], x: number, z: number): number {
  let floor = GROUND_CLEARANCE;
  for (let i = 0; i < solids.length; i++) {
    const solid = solids[i];
    const away = distanceToBox(x, z, solid) - CAMERA_MARGIN;
    if (away >= CAMERA_RAMP) continue;
    const top = solid.height + CAMERA_MARGIN;
    const t = away <= 0 ? 0 : away / CAMERA_RAMP;
    const ease = 1 - t * t * (3 - 2 * t); // smoothstep down from 1 to 0
    floor = Math.max(floor, GROUND_CLEARANCE + (top - GROUND_CLEARANCE) * ease);
  }
  return floor;
}

/**
 * Hex-grid standing spots inside an outline, a blob's radius clear of its edge and its reach
 * clear of every obstacle, sorted nearest the outline's middle first so a smaller crowd fills
 * the centre.
 */
export function standingSpots(outline: Point[], obstacles: Obstacle[]): Point[] {
  const xs = outline.map((p) => p.x);
  const zs = outline.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const middle = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const row = (SPOT_SPACING * Math.sqrt(3)) / 2;

  const spots: Point[] = [];
  // Anchored on the middle, so the same outline always gives the same grid.
  const rows = Math.ceil((maxZ - minZ) / 2 / row);
  const columns = Math.ceil((maxX - minX) / 2 / SPOT_SPACING) + 1;
  for (let r = -rows; r <= rows; r++) {
    const shift = (Math.abs(r) % 2) * (SPOT_SPACING / 2);
    for (let c = -columns; c <= columns; c++) {
      const p = { x: middle.x + c * SPOT_SPACING + shift, z: middle.z + r * row };
      if (!insidePolygon(p, outline)) continue;
      if (distanceToOutline(p, outline) < BLOB_RADIUS) continue;
      if (obstacles.some((o) => distanceToObstacle(p, o) < BLOB_REACH)) continue;
      spots.push(p);
    }
  }
  const away = (p: Point) => Math.hypot(p.x - middle.x, p.z - middle.z);
  return spots.sort((a, b) => away(a) - away(b) || a.x - b.x || a.z - b.z);
}

/** Tiny seeded PRNG (mulberry32): deterministic jitter without a dependency. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

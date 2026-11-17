// The plaza's standing grid drawn as hex paving: one tile round each standing spot, cut to fit
// the paving. Pure maths, so the scene and the tests share it.
import { ShapeUtils, Vector2 } from "three";
import { type Point, SPOT_SPACING } from "./mapLayout.ts";

/** The joint between neighbouring tiles, and twice the joint along the paving's edge. */
export const GROUT = 0.14;

// Spots sit on a hex grid in rows along x, so each one's cell is a hexagon with flat sides
// facing its neighbours (east, west and the four diagonals) and points to the north and south.
const INRADIUS = (SPOT_SPACING - GROUT) / 2;
export const TILE_RADIUS = INRADIUS / Math.cos(Math.PI / 6);

/** The six corners of the uncut tile round a spot, anticlockwise seen from above. */
export function hexTile(spot: Point): Point[] {
  return Array.from({ length: 6 }, (_, k) => {
    // From the point at 30° off +x, stepping back towards -z (anticlockwise from above).
    const angle = Math.PI / 6 - (k * Math.PI) / 3;
    return {
      x: spot.x + TILE_RADIUS * Math.cos(angle),
      z: spot.z + TILE_RADIUS * Math.sin(angle),
    };
  });
}

/** Twice the signed area: positive when anticlockwise seen from above (as hexTile winds). */
function twiceArea(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[i].x * polygon[j].z - polygon[j].x * polygon[i].z;
  }
  return sum;
}

/** A simple polygon with every edge moved `d` inwards (a mitred offset; fine while d is small). */
export function insetPolygon(polygon: Point[], d: number): Point[] {
  const turn = Math.sign(twiceArea(polygon));
  const n = polygon.length;
  // Inward unit normal of the edge from a to b.
  const inward = (a: Point, b: Point) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: (turn * (b.z - a.z)) / length, z: (-turn * (b.x - a.x)) / length };
  };
  return polygon.map((p, i) => {
    const before = inward(polygon[(i + n - 1) % n], p);
    const after = inward(p, polygon[(i + 1) % n]);
    const miter = d / (1 + before.x * after.x + before.z * after.z);
    return { x: p.x + (before.x + after.x) * miter, z: p.z + (before.z + after.z) * miter };
  });
}

// Sutherland-Hodgman: what of `subject` (any simple polygon) lies inside the convex `clip`,
// which winds anticlockwise.
function clipToConvex(subject: Point[], clip: Point[]): Point[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    // Positive on the inside (the left of a → b, anticlockwise from above).
    const side = (p: Point) => (b.z - a.z) * (p.x - a.x) - (b.x - a.x) * (p.z - a.z);
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
  }
  return out;
}

/**
 * Each spot's tile: its hex, cut back to half a joint inside the paving's outline, so no tile
 * runs onto the beds or off the kerb. Anticlockwise from above; tiles clear of the edge stay
 * whole hexes.
 */
export function tileOutlines(spots: readonly Point[], outline: Point[]): Point[][] {
  const paving = insetPolygon(outline, GROUT / 2);
  const anticlockwise = twiceArea(paving) > 0 ? paving : [...paving].reverse();
  return spots.map((spot) => clipToConvex(anticlockwise, hexTile(spot)));
}

/** Tiles as flat triangles facing up at height `y`: x, y, z per vertex. */
export function tilePositions(tiles: Point[][], y: number): Float32Array {
  const positions: number[] = [];
  for (const tile of tiles) {
    const faces = ShapeUtils.triangulateShape(
      tile.map((p) => new Vector2(p.x, p.z)),
      [],
    );
    for (const [a, b, c] of faces) {
      // Wound so the normal (b - a) x (c - a) points up.
      const [p, q, r] = [tile[a], tile[b], tile[c]];
      const up = (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z);
      for (const v of up > 0 ? [p, q, r] : [p, r, q]) positions.push(v.x, y, v.z);
    }
  }
  return new Float32Array(positions);
}

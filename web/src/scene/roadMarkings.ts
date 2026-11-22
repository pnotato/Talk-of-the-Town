// Paint on the city's roads as flat rectangles: plain data, so tests can pin where it goes.
import {
  CROSSWALK,
  CROSSWALK_GAP,
  type CityCrosswalk,
  type CityRect,
  roadStretches,
} from "./layoutCity.ts";

const STRIPE = 0.55;
const DASH = 2;
const LINE = 0.18;
// Dashes stop this far short of where a crossing is (or would be, on the ring road).
const DASH_CLEAR = 1.5;

/** The zebra stripes of every crossing, across its road, a little in from each kerb. */
export function zebraStripes(crosswalks: CityCrosswalk[]): CityRect[] {
  const stripes: CityRect[] = [];
  for (const c of crosswalks) {
    const width = c.axis === "x" ? c.width : c.depth; // the road's, kerb to kerb
    for (let s = -width / 2 + 0.6; s + STRIPE <= width / 2 - 0.4; s += 2 * STRIPE) {
      stripes.push(
        c.axis === "x"
          ? { x: c.x + (s + STRIPE / 2), z: c.z, width: STRIPE, depth: c.depth }
          : { x: c.x, z: c.z + (s + STRIPE / 2), width: c.width, depth: STRIPE },
      );
    }
  }
  return stripes;
}

/** Lane dashes down the middle of every road between its junctions and their crossings. */
export function laneDashes(roads: CityRect[]): CityRect[] {
  const dashes: CityRect[] = [];
  for (const road of roads) {
    const vertical = road.depth > road.width;
    for (const [a, b] of roadStretches(road, roads)) {
      for (
        let from = a + CROSSWALK_GAP + CROSSWALK + DASH_CLEAR;
        from + DASH <= b - CROSSWALK_GAP - CROSSWALK - DASH_CLEAR;
        from += 2 * DASH
      ) {
        const to = from + DASH;
        dashes.push(
          vertical
            ? { x: road.x, z: (from + to) / 2, width: LINE, depth: to - from }
            : { x: (from + to) / 2, z: road.z, width: to - from, depth: LINE },
        );
      }
    }
  }
  return dashes;
}

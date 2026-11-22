// Paint on the city's roads as flat rectangles: plain data, so tests can pin where it goes.
import type { CityLayout, CityRect } from "./layoutCity.ts";

const CROSSWALK = 2.4; // depth of a zebra crossing along the road
const STRIPE = 0.55;
const DASH = 2;
const LINE = 0.18;

/**
 * Lane dashes down the middle of every road between junctions, and zebra crossings across
 * each road where it leaves a junction (not on the outer ring road, which leads nowhere).
 */
export function roadMarkings(city: CityLayout): CityRect[] {
  const { roads, bounds } = city;
  const marks: CityRect[] = [];
  for (const road of roads) {
    const vertical = road.depth > road.width;
    const along = (r: CityRect) =>
      vertical ? [r.z - r.depth / 2, r.z + r.depth / 2] : [r.x - r.width / 2, r.x + r.width / 2];
    const across = vertical ? road.x : road.z;
    const width = vertical ? road.width : road.depth;
    const outer = vertical
      ? road.x - width / 2 <= bounds.minX || road.x + width / 2 >= bounds.maxX
      : road.z - width / 2 <= bounds.minZ || road.z + width / 2 >= bounds.maxZ;
    const junctions = roads
      .filter((r) => r.depth > r.width !== vertical)
      .map(along)
      .sort((a, b) => a[0] - b[0]);
    const rect = (from: number, to: number, offset: number, size: number): CityRect =>
      vertical
        ? { x: across + offset, z: (from + to) / 2, width: size, depth: to - from }
        : { x: (from + to) / 2, z: across + offset, width: to - from, depth: size };

    for (let k = 0; k + 1 < junctions.length; k++) {
      const a = junctions[k][1];
      const b = junctions[k + 1][0];
      if (!outer) {
        for (const [from, to] of [
          [a + 0.6, a + 0.6 + CROSSWALK],
          [b - 0.6 - CROSSWALK, b - 0.6],
        ]) {
          for (let s = -width / 2 + 0.6; s + STRIPE <= width / 2 - 0.4; s += 2 * STRIPE) {
            marks.push(rect(from, to, s + STRIPE / 2, STRIPE));
          }
        }
      }
      for (
        let d = a + 0.6 + CROSSWALK + 1.5;
        d + DASH <= b - 0.6 - CROSSWALK - 1.5;
        d += 2 * DASH
      ) {
        marks.push(rect(d, d + DASH, 0, LINE));
      }
    }
  }
  return marks;
}

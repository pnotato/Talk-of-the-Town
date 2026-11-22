/// <reference types="node" />
// Run: node --test web/src/scene/roadMarkings.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type CityLayout, type CityRect, layoutCity } from "./layoutCity.ts";
import { laneDashes, zebraStripes } from "./roadMarkings.ts";

const CASES: [homes: number, neighbourhoods: number][] = [
  [0, 1],
  [1, 1],
  [10, 3],
  [53, 5],
  [100, 5],
  [100, 8],
  [200, 5],
  [200, 8],
];

// The road paint as CityGround drew it before crosswalks were layout data, kept verbatim so
// the zebra stripes and lane dashes stay exactly where they were, to the last bit.
function oldRoadMarkings(city: CityLayout): CityRect[] {
  const CROSSWALK = 2.4;
  const STRIPE = 0.55;
  const DASH = 2;
  const LINE = 0.18;
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

describe("road markings", () => {
  for (const [homes, hoods] of CASES) {
    test(`${homes} homes, ${hoods} neighbourhoods: the paint is where it always was`, () => {
      const city = layoutCity(homes, hoods);
      // A zebra stripe is 0.55 across its road, a lane dash 0.18.
      const old = oldRoadMarkings(city);
      const stripe = (r: CityRect) => Math.min(r.width, r.depth) === 0.55;
      const stripes = zebraStripes(city.crosswalks);
      assert.ok(stripes.length > 0);
      assert.deepEqual(stripes, old.filter(stripe));
      assert.deepEqual(
        laneDashes(city.roads),
        old.filter((r) => !stripe(r)),
      );
    });
  }
});

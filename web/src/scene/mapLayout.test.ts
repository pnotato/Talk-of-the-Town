/// <reference types="node" />
// Run: node --test web/src/scene/mapLayout.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  distanceToObstacle,
  distanceToOutline,
  insidePolygon,
  type Obstacle,
  type Point,
  polygonArea,
  SPOT_SPACING,
  standingSpots,
} from "./mapLayout.ts";

// A bow-tie: wide at both ends, pinched at the waist (concave at two corners).
const BOW_TIE: Point[] = [
  { x: -20, z: -10 },
  { x: 0, z: -4 },
  { x: 20, z: -10 },
  { x: 20, z: 10 },
  { x: 0, z: 4 },
  { x: -20, z: 10 },
];

const OBSTACLES: Obstacle[] = [
  { kind: "disc", x: -10, z: 0, radius: 2 },
  { kind: "box", x: 10, z: 3, width: 6, depth: 2, rotationY: 0.4 },
];

describe("map geometry", () => {
  test("inside tells the pinched waist from the ends", () => {
    assert.ok(insidePolygon({ x: -15, z: 8 }, BOW_TIE));
    assert.ok(insidePolygon({ x: 0, z: 0 }, BOW_TIE));
    assert.ok(!insidePolygon({ x: 0, z: 6 }, BOW_TIE), "the notch at the waist is outside");
    assert.ok(!insidePolygon({ x: 25, z: 0 }, BOW_TIE));
  });

  test("area of the bow-tie", () => {
    // Two trapezoids, ends 20 deep, waist 8 deep, each 20 long.
    assert.equal(polygonArea(BOW_TIE), 2 * ((20 + 8) / 2) * 20);
  });

  test("distance to a turned box", () => {
    const box: Obstacle = { kind: "box", x: 0, z: 0, width: 4, depth: 2, rotationY: Math.PI / 2 };
    // Turned a quarter, its 4-long side runs along z.
    assert.equal(distanceToObstacle({ x: 0, z: 1.5 }, box), 0);
    assert.ok(Math.abs(distanceToObstacle({ x: 3, z: 0 }, box) - 2) < 1e-9);
    assert.ok(Math.abs(distanceToObstacle({ x: 0, z: 5 }, box) - 3) < 1e-9);
  });
});

describe("standingSpots", () => {
  const spots = standingSpots(BOW_TIE, OBSTACLES);

  test("same outline gives the same spots", () => {
    assert.deepEqual(standingSpots(BOW_TIE, OBSTACLES), spots);
  });

  test("fills the outline about as densely as a hex grid can", () => {
    const perSpot = (Math.sqrt(3) / 2) * SPOT_SPACING ** 2;
    assert.ok(spots.length > (0.75 * polygonArea(BOW_TIE)) / perSpot, `${spots.length} spots`);
  });

  test("every spot is inside, a blob's radius clear of the edge and the furniture", () => {
    for (const p of spots) {
      assert.ok(insidePolygon(p, BOW_TIE));
      assert.ok(distanceToOutline(p, BOW_TIE) >= 0.6 - 1e-9);
      for (const o of OBSTACLES) assert.ok(distanceToObstacle(p, o) >= 0.6 - 1e-9);
    }
  });

  test("spots never crowd closer than the spacing", () => {
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const d = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
        assert.ok(d >= SPOT_SPACING - 1e-9, `spots ${i} and ${j} are ${d.toFixed(2)} apart`);
      }
    }
  });

  test("nearest the middle come first", () => {
    const away = (p: Point) => Math.hypot(p.x, p.z);
    for (let i = 1; i < spots.length; i++) assert.ok(away(spots[i]) >= away(spots[i - 1]));
  });
});

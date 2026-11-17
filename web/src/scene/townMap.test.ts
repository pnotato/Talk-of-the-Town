/// <reference types="node" />
// Run: node --test web/src/scene/townMap.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { HOME_DEPTH, layoutTown } from "./layoutTown.ts";
import { distanceToOutline, insidePolygon } from "./mapLayout.ts";
import { townMap } from "./townMap.ts";

const town = layoutTown(53, 5);
const map = townMap(town);

test("homes keep their index and neighbourhood, with the door on the front face", () => {
  assert.equal(map.homes.length, 53);
  map.homes.forEach((h, i) => {
    const home = town.homes[i];
    assert.equal(h.index, i);
    assert.equal(h.neighbourhood, i % 5);
    assert.equal(h.facing, home.rotationY);
    assert.ok(Math.abs(Math.hypot(h.door.x - home.x, h.door.z - home.z) - HOME_DEPTH / 2) < 1e-9);
  });
});

test("the square has a standing spot for each of 100 blobs, clear of the fountain", () => {
  const { spots, outline } = map.gathering;
  assert.ok(spots.length >= 100, `${spots.length} spots`);
  for (const p of spots) {
    assert.ok(insidePolygon(p, outline));
    assert.ok(distanceToOutline(p, outline) >= 0.6 - 1e-9);
    const fromCentre = Math.hypot(p.x - town.square.x, p.z - town.square.z);
    assert.ok(fromCentre >= town.square.fountainRadius + 0.6 - 1e-9);
  }
});

test("framing and shadows see the same town as before", () => {
  // 32 samples, at the ground and at the top, around the square and each neighbourhood.
  assert.equal(map.frame.length, 2 * 32 * 6);
  assert.equal(map.casters.length, 6 + town.trees.length);
  assert.equal(map.roam, "ellipse");
  assert.deepEqual(map.bounds, town.bounds);
});

/// <reference types="node" />
// Run: node --test web/src/scene/townMap.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HOME_TOP,
  LAMP_HEIGHT,
  layoutTown,
  ROOF_PLANT,
  TREE_HEIGHT,
  TREE_RADIUS,
} from "./layoutTown.ts";
import {
  BLOB_RADIUS,
  BLOB_REACH,
  type Box,
  cameraFloor,
  distanceToBox,
  distanceToOutline,
  insidePolygon,
  type Point,
  type Solid,
  SPOT_SPACING,
} from "./mapLayout.ts";
import { boxCorners, townMap } from "./townMap.ts";

const EPS = 1e-6;

// Every part of `box` lies inside one solid at least `top` high.
function covered(solids: Solid[], box: Box, top: number): boolean {
  const points = [...boxCorners(box), box];
  return solids.some(
    (s) => s.height >= top - EPS && points.every((p) => distanceToBox(p.x, p.z, s) <= EPS),
  );
}

describe("townMap", () => {
  const town = layoutTown(53, 5);
  const map = townMap(town);

  test("homes keep their index and neighbourhood, with the door mid-front facing out", () => {
    assert.equal(map.homes.length, 53);
    map.homes.forEach((h, i) => {
      const home = town.homes[i];
      assert.equal(h.index, i);
      assert.equal(h.neighbourhood, i % 5);
      assert.equal(h.facing, home.rotationY);
      const out = { x: h.door.x - home.x, z: h.door.z - home.z };
      assert.ok(Math.abs(Math.hypot(out.x, out.z) - home.depth / 2) < EPS);
      // Straight out of the front, the way the home faces.
      const dot = (out.x * Math.sin(h.facing) + out.z * Math.cos(h.facing)) / (home.depth / 2);
      assert.ok(Math.abs(dot - 1) < EPS);
    });
  });

  test("the square is the gathering place, with room for 100 blobs clear of everything", () => {
    const [square, ...others] = map.gathering.areas;
    assert.equal(square.name, "square");
    assert.equal(others.length, 0);
    assert.ok(square.spots.length >= 100, `only ${square.spots.length} spots`);
    const blockers: Box[] = [town.screen.footprint, ...town.props];
    for (const p of square.spots) {
      assert.ok(insidePolygon(p, square.outline));
      assert.ok(distanceToOutline(p, square.outline) >= BLOB_RADIUS - EPS);
      for (const b of blockers) assert.ok(distanceToBox(p.x, p.z, b) >= BLOB_REACH - EPS);
      for (const t of town.trees) {
        const d = Math.hypot(p.x - t.x, p.z - t.z) - TREE_RADIUS * t.size;
        assert.ok(d >= BLOB_REACH - EPS, "a spot is under a tree");
      }
    }
  });

  test("the whole crowd stands in front of the screen, which faces the square's middle", () => {
    const { panel } = town.screen;
    assert.ok(Math.abs(panel.x - town.square.x) < EPS);
    assert.ok(Math.abs(panel.rotationY) < EPS, "the panel does not face south (+z)");
    for (const p of map.gathering.areas[0].spots) assert.ok(p.z - panel.z > BLOB_REACH);
    // A crowd fills from the middle out; the first 100 all see the screen within 70 degrees
    // of straight on.
    for (const p of map.gathering.areas[0].spots.slice(0, 100)) {
      const off = Math.atan2(Math.abs(p.x - panel.x), p.z - panel.z);
      assert.ok(off < (70 * Math.PI) / 180, `a spot sees the screen ${off.toFixed(2)} off`);
    }
  });

  test("solids cover every home, building, tower, the screen, the lamps and the trees", () => {
    const { solids } = map;
    for (const h of town.homes) assert.ok(covered(solids, h, HOME_TOP * h.heightScale));
    for (const b of town.buildings) {
      assert.ok(covered(solids, b, b.height + ROOF_PLANT), `${b.kind} is not covered`);
      if (b.tower) assert.ok(covered(solids, b.tower, b.tower.height));
    }
    assert.ok(covered(solids, town.screen.footprint, town.screen.top));
    for (const p of town.props.filter((p) => p.kind === "lamp")) {
      assert.ok(covered(solids, p, LAMP_HEIGHT));
    }
    for (const t of town.trees) {
      const span = 2 * TREE_RADIUS * t.size;
      const canopy = { x: t.x, z: t.z, width: span, depth: span, rotationY: 0 };
      assert.ok(covered(solids, canopy, TREE_HEIGHT * t.size));
    }
  });

  test("the camera floor lifts the camera over the clock tower and the screen", () => {
    const tower = town.buildings.find((b) => b.tower)?.tower as Solid;
    assert.ok(cameraFloor(map.solids, tower.x, tower.z) > tower.height);
    const { footprint, top } = town.screen;
    assert.ok(cameraFloor(map.solids, footprint.x, footprint.z) > top);
    assert.ok(map.height >= Math.max(...map.solids.map((s) => s.height)));
  });

  test("the default view frames every block and the tops of the tall things", () => {
    const corner = (p: Point, y: number) =>
      map.frame.some((f) => Math.abs(f.x - p.x) < EPS && Math.abs(f.z - p.z) < EPS && f.y >= y);
    for (const b of town.blocks) {
      for (const c of boxCorners({ ...b, rotationY: 0 })) assert.ok(corner(c, 0));
    }
    const tower = town.buildings.find((b) => b.tower)?.tower as Solid;
    assert.ok(boxCorners(tower).every((c) => corner(c, tower.height)));
    assert.deepEqual(map.bounds, town.bounds);
    assert.equal(map.roam, "box");
    assert.ok(map.casters.length >= map.solids.length);
  });

  for (const [homes, hoods] of [
    [0, 1],
    [2, 8],
    [10, 3],
    [100, 5],
    [200, 2],
    [200, 8],
  ]) {
    test(`${homes} homes in ${hoods}: 4 cells each for 100 blobs, 1 each for 2 a home`, () => {
      const spots = townMap(layoutTown(homes, hoods)).gathering.areas[0].spots;
      assert.ok(spots.length >= Math.max(4 * 100, 2 * homes), `only ${spots.length} spots`);
    });
  }

  // The square grows with the town, which slides its grid across the rows of trees and
  // benches; whatever its size, no cell may be boxed in behind them.
  test("every cell on the square steps to every other, whatever the town's size", () => {
    for (let homes = 0; homes <= 240; homes++) {
      const spots = townMap(layoutTown(homes, 5)).gathering.areas[0].spots;
      const seen = new Set([0]);
      const queue = [0];
      while (queue.length > 0) {
        const a = spots[queue.pop() as number];
        spots.forEach((b, j) => {
          const step = Math.hypot(a.x - b.x, a.z - b.z);
          if (!seen.has(j) && Math.abs(step - SPOT_SPACING) < EPS) {
            seen.add(j);
            queue.push(j);
          }
        });
      }
      const cut = spots.filter((_, j) => !seen.has(j));
      assert.equal(cut.length, 0, `${homes} homes: cut off at ${JSON.stringify(cut[0])}`);
    }
  });
});

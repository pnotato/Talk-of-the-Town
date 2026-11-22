/// <reference types="node" />
// Run: node --test web/src/scene/townMapExport.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { layoutTown, TOWN_HOMES, TOWN_NEIGHBOURHOODS } from "./layoutTown.ts";
import { BLOB_RADIUS, gatheringSpots, SPOT_SPACING } from "./mapLayout.ts";
import { townMap, townWalkObstacles } from "./townMap.ts";
import { exportTownMap } from "./townMapExport.ts";

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface TownMapFile {
  version: number;
  layout: { homeCount: number; neighbourhoodCount: number };
  blobRadius: number;
  spotSpacing: number;
  areas: { name: string; rect: Rect; spots: [number, number][] }[];
  crosswalks: unknown[];
  discs: { kind: string; x: number; z: number; r: number }[];
  boxes: { kind: string; rect: Rect }[];
}

const near = (a: number, b: number) => Math.abs(a - b) <= 5e-7;

describe("exportTownMap", () => {
  const town = layoutTown(TOWN_HOMES, TOWN_NEIGHBOURHOODS);
  const map = townMap(town);
  const text = exportTownMap(town, TOWN_HOMES, TOWN_NEIGHBOURHOODS);
  const file = JSON.parse(text) as TownMapFile;

  test("parses as JSON, version 1, with the town's counts and blob sizes", () => {
    assert.equal(file.version, 1);
    assert.deepEqual(file.layout, {
      homeCount: TOWN_HOMES,
      neighbourhoodCount: TOWN_NEIGHBOURHOODS,
    });
    assert.equal(file.blobRadius, BLOB_RADIUS);
    assert.equal(file.spotSpacing, SPOT_SPACING);
  });

  test("the square is the only walkable area, with the same spots in the same order", () => {
    assert.deepEqual(
      file.areas.map((a) => a.name),
      map.gathering.areas.map((a) => a.name),
    );
    const spots = file.areas.flatMap((a) => a.spots);
    const expected = gatheringSpots(map.gathering);
    assert.equal(spots.length, expected.length);
    assert.ok(spots.length >= 100, `only ${spots.length} spots`);
    spots.forEach(([x, z], i) => {
      assert.ok(near(x, expected[i].x) && near(z, expected[i].z), `spot ${i}`);
    });
  });

  test("the square is an axis-aligned rect round its outline; there are no crossings", () => {
    const [square] = map.gathering.areas;
    const xs = square.outline.map((p) => p.x);
    const zs = square.outline.map((p) => p.z);
    const r = file.areas[0].rect;
    assert.ok(near(r.minX, Math.min(...xs)) && near(r.maxX, Math.max(...xs)));
    assert.ok(near(r.minZ, Math.min(...zs)) && near(r.maxZ, Math.max(...zs)));
    assert.deepEqual(file.crosswalks, []);
  });

  test("obstacles keep their kinds and order: trees, then the screen, beds and benches", () => {
    const expected = townWalkObstacles(town);
    assert.deepEqual(
      file.discs.map((d) => d.kind),
      expected.filter((o) => o.obstacle.kind === "disc").map((o) => o.what),
    );
    assert.deepEqual(
      file.boxes.map((b) => b.kind),
      expected.filter((o) => o.obstacle.kind === "box").map((o) => o.what),
    );
    const screen = file.boxes.find((b) => b.kind === "screen");
    assert.ok(screen);
    const { x, z, width, depth } = town.screen.footprint;
    assert.deepEqual(screen, {
      kind: "screen",
      rect: { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 },
    });
  });

  test("the same town always gives the same bytes", () => {
    assert.equal(
      exportTownMap(layoutTown(TOWN_HOMES, TOWN_NEIGHBOURHOODS), TOWN_HOMES, TOWN_NEIGHBOURHOODS),
      text,
    );
  });

  test("throws when the counts are not the town's", () => {
    assert.throws(() => exportTownMap(town, TOWN_HOMES - 1, TOWN_NEIGHBOURHOODS), RangeError);
    assert.throws(() => exportTownMap(town, TOWN_HOMES, TOWN_NEIGHBOURHOODS - 1), RangeError);
  });
});

/// <reference types="node" />
// Run: node --test web/src/scene/cityMapExport.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { exportCityMap } from "./cityMapExport.ts";
import { type CityLayout, DOOR_WIDTH, DOORSTEP, layoutCity } from "./layoutCity.ts";
import { TREE_RADIUS } from "./layoutTown.ts";
import { BLOB_RADIUS, gatheringSpots, type Point, SPOT_SPACING } from "./mapLayout.ts";

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface CityMap {
  version: number;
  layout: { homeCount: number; neighbourhoodCount: number };
  blobRadius: number;
  spotSpacing: number;
  areas: { name: string; rect: Rect; spots: [number, number][] }[];
  crosswalks: { rect: Rect; axis: "x" | "z" }[];
  discs: { kind: string; x: number; z: number; r: number }[];
  boxes: { kind: string; rect: Rect }[];
}

// Written to a millionth, so a value read back is within half of one.
const ROUNDING = 5e-7 + 1e-12;
const near = (a: number, b: number) => Math.abs(a - b) <= ROUNDING;

const outline = (r: Rect): Point[] => [
  { x: r.minX, z: r.minZ },
  { x: r.maxX, z: r.minZ },
  { x: r.maxX, z: r.maxZ },
  { x: r.minX, z: r.maxZ },
];

function rectNear(a: Rect, b: Rect): boolean {
  return (
    near(a.minX, b.minX) && near(a.maxX, b.maxX) && near(a.minZ, b.minZ) && near(a.maxZ, b.maxZ)
  );
}

// Clear distance from a point to a rectangle; 0 inside it.
function distanceToRect(p: Point, r: Rect): number {
  return Math.hypot(
    Math.max(r.minX - p.x, 0, p.x - r.maxX),
    Math.max(r.minZ - p.z, 0, p.z - r.maxZ),
  );
}

describe("exportCityMap", () => {
  const city = layoutCity(53, 5);
  const text = exportCityMap(city, 53, 5);
  const map = JSON.parse(text) as CityMap;

  test("parses as JSON, version 1, with the city's counts and blob sizes", () => {
    assert.equal(map.version, 1);
    assert.deepEqual(map.layout, { homeCount: 53, neighbourhoodCount: 5 });
    assert.equal(map.blobRadius, BLOB_RADIUS);
    assert.equal(map.spotSpacing, SPOT_SPACING);
    assert.deepEqual(Object.keys(map), [
      "version",
      "layout",
      "blobRadius",
      "spotSpacing",
      "areas",
      "crosswalks",
      "discs",
      "boxes",
    ]);
  });

  test("34 areas, 752 spots, 24 crosswalks, 50 discs, 15 boxes", () => {
    assert.equal(map.areas.length, 34);
    assert.equal(
      map.areas.reduce((sum, a) => sum + a.spots.length, 0),
      752,
    );
    assert.equal(map.crosswalks.length, 24);
    assert.equal(map.discs.length, 50);
    assert.equal(map.boxes.length, 15);
  });

  test("the spots, area by area, are gatheringSpots in order", () => {
    const spots = map.areas.flatMap((a) => a.spots);
    const expected = gatheringSpots(city.gathering);
    assert.equal(spots.length, expected.length);
    spots.forEach(([x, z], i) => {
      assert.ok(near(x, expected[i].x) && near(z, expected[i].z), `spot ${i}`);
    });
  });

  test("areas keep their names and order, each its outline's rectangle", () => {
    assert.deepEqual(
      map.areas.map((a) => a.name),
      city.gathering.areas.map((a) => a.name),
    );
    assert.deepEqual(map.areas[0].rect, { minX: -23, maxX: 23, minZ: -12, maxZ: 12 });
    map.areas.forEach((a, i) => {
      const { outline } = city.gathering.areas[i];
      const xs = outline.map((p) => p.x);
      const zs = outline.map((p) => p.z);
      const box = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      };
      assert.ok(rectNear(a.rect, box), `area ${i}`);
    });
  });

  test("crosswalks are the city's, in order", () => {
    map.crosswalks.forEach((c, i) => {
      const w = city.crosswalks[i];
      assert.equal(c.axis, w.axis);
      const r = {
        minX: w.x - w.width / 2,
        maxX: w.x + w.width / 2,
        minZ: w.z - w.depth / 2,
        maxZ: w.z + w.depth / 2,
      };
      assert.ok(rectNear(c.rect, r), `crosswalk ${i}`);
    });
    assert.deepEqual(map.crosswalks[9], {
      rect: { minX: 20, maxX: 22.4, minZ: -19, maxZ: -12 },
      axis: "z",
    });
  });

  test("discs are every lamp, then the 14 park trees: the only trees near an area", () => {
    const lamps = map.discs.filter((d) => d.kind === "lamp");
    const trees = map.discs.filter((d) => d.kind === "tree");
    assert.deepEqual(
      map.discs.map((d) => d.kind),
      [...lamps.map(() => "lamp"), ...trees.map(() => "tree")],
    );
    assert.equal(lamps.length, city.lamps.length);
    assert.deepEqual(map.discs[0], { kind: "lamp", x: -22.2, z: -36.2, r: 0.3 });
    lamps.forEach((d, i) => assert.ok(near(d.x, city.lamps[i].x) && near(d.z, city.lamps[i].z)));
    assert.equal(trees.length, 14);
    const [lawn] = city.parks;
    const nearArea = city.trees.filter((t) =>
      map.areas.some((a) => distanceToRect(t, a.rect) - TREE_RADIUS * t.size <= 2),
    );
    assert.equal(trees.length, nearArea.length);
    trees.forEach((d, i) => {
      const t = nearArea[i];
      assert.ok(near(d.x, t.x) && near(d.z, t.z) && near(d.r, TREE_RADIUS * t.size));
      assert.ok(Math.abs(d.x - lawn.x) < lawn.width / 2 && Math.abs(d.z - lawn.z) < lawn.depth / 2);
    });
  });

  test("boxes are the buildings, then the kiosks; no doorstep", () => {
    const kinds = map.boxes.map((b) => b.kind);
    assert.deepEqual(kinds, [...city.buildings.map(() => "building"), "kiosk", "kiosk"]);
    assert.deepEqual(map.boxes[0], {
      kind: "building",
      rect: { minX: -20.5, maxX: 20.5, minZ: -34.5, maxZ: -21.5 },
    });
    for (const h of city.homes) {
      const turned = Math.abs(Math.sin(h.facing)) > 0.5;
      const step = {
        x: h.door.x + (Math.sin(h.facing) * DOORSTEP) / 2,
        z: h.door.z + (Math.cos(h.facing) * DOORSTEP) / 2,
      };
      const [w, d] = turned ? [DOORSTEP, DOOR_WIDTH] : [DOOR_WIDTH, DOORSTEP];
      const r = {
        minX: step.x - w / 2,
        maxX: step.x + w / 2,
        minZ: step.z - d / 2,
        maxZ: step.z + d / 2,
      };
      assert.ok(!map.boxes.some((b) => rectNear(b.rect, r)), `home ${h.index}'s doorstep is a box`);
    }
  });

  test("the same city always gives the same bytes", () => {
    assert.equal(exportCityMap(city, 53, 5), text);
    assert.equal(exportCityMap(layoutCity(53, 5), 53, 5), text);
  });

  test("one line each: the header, every list's items, and a newline at the end", () => {
    const lines = text.split("\n");
    assert.equal(lines.pop(), "");
    assert.ok(lines[0].startsWith('{"version":1,"layout":{"homeCount":53,"neighbourhoodCount":5}'));
    assert.ok(lines[0].endsWith(',"blobRadius":0.6,"spotSpacing":1.8,'));
    let at = 1;
    for (const [key, count, item] of [
      [
        "areas",
        34,
        /^\{"name":"[a-z]+","rect":\{"minX":[^,]+,"maxX":[^,]+,"minZ":[^,]+,"maxZ":[^,]+\},"spots":\[\[/,
      ],
      [
        "crosswalks",
        24,
        /^\{"rect":\{"minX":[^,]+,"maxX":[^,]+,"minZ":[^,]+,"maxZ":[^,]+\},"axis":"[xz]"\}/,
      ],
      ["discs", 50, /^\{"kind":"(lamp|tree)","x":[^,]+,"z":[^,]+,"r":[^,]+\}/],
      [
        "boxes",
        15,
        /^\{"kind":"(building|kiosk)","rect":\{"minX":[^,]+,"maxX":[^,]+,"minZ":[^,]+,"maxZ":[^,]+\}\}/,
      ],
    ] as const) {
      assert.equal(lines[at++], `"${key}":[`);
      for (let i = 0; i < count; i++) {
        const line = lines[at++];
        assert.match(line, item);
        assert.equal(line.endsWith(","), i < count - 1, `${key} ${i} ends wrongly`);
      }
      assert.equal(lines[at++], key === "boxes" ? "]}" : "],");
    }
    assert.equal(at, lines.length);
  });

  test("numbers are rounded to a millionth, -0 is 0, and never an exponent", () => {
    const odd = structuredClone(city);
    odd.lamps[0] = { x: -0, z: 1.23456789 };
    odd.lamps[1] = { x: -1e-7, z: 2.0000004 };
    odd.lamps[2] = { x: 1e-6, z: -123456.0000004 };
    const out = exportCityMap(odd, 53, 5);
    const discs = out.split("\n").filter((l) => l.startsWith('{"kind":"lamp"'));
    assert.equal(discs[0], '{"kind":"lamp","x":0,"z":1.234568,"r":0.3},');
    assert.equal(discs[1], '{"kind":"lamp","x":0,"z":2,"r":0.3},');
    assert.equal(discs[2], '{"kind":"lamp","x":0.000001,"z":-123456,"r":0.3},');
    assert.doesNotMatch(out, /\d[eE][+-]?\d/);
    assert.doesNotMatch(out, /-0[,\]}]/);
    odd.lamps[0] = { x: Number.NaN, z: 0 };
    assert.throws(() => exportCityMap(odd, 53, 5), RangeError);
  });

  test("throws on an area that is not an axis-aligned rectangle", () => {
    const r = { minX: 0, maxX: 4, minZ: 0, maxZ: 2 };
    const [a, b, c, d] = outline(r);
    for (const bad of [
      [a, b, { x: 4, z: 1 }, { x: 2, z: 1 }, { x: 2, z: 2 }, d], // an L
      [a, c, b, d], // a bow-tie through the same corners
      [
        { x: 2, z: 0 },
        { x: 4, z: 1 },
        { x: 2, z: 2 },
        { x: 0, z: 1 },
      ], // turned
      [a, b, c], // a triangle
    ]) {
      const odd = structuredClone(city);
      odd.gathering.areas[3].outline = bad;
      assert.throws(() => exportCityMap(odd, 53, 5), /not an axis-aligned rectangle/);
    }
  });

  test("a box must be turned by whole quarters; a quarter turn swaps its sides", () => {
    const odd = structuredClone(city);
    odd.furniture = [
      { ...city.furniture[0], x: 1, z: 2, width: 2, depth: 1, rotationY: Math.PI / 2 },
    ];
    const kiosk = (JSON.parse(exportCityMap(odd, 53, 5)) as CityMap).boxes.at(-1);
    assert.deepEqual(kiosk, { kind: "kiosk", rect: { minX: 0.5, maxX: 1.5, minZ: 1, maxZ: 3 } });
    odd.furniture[0].rotationY = -Math.PI;
    const flipped = (JSON.parse(exportCityMap(odd, 53, 5)) as CityMap).boxes.at(-1);
    assert.deepEqual(flipped, { kind: "kiosk", rect: { minX: 0, maxX: 2, minZ: 1.5, maxZ: 2.5 } });
    odd.furniture[0].rotationY = Math.PI / 4;
    assert.throws(() => exportCityMap(odd, 53, 5), /quarter/);
  });

  test("throws when the counts are not the city's", () => {
    assert.throws(() => exportCityMap(city, 52, 5), RangeError);
    assert.throws(() => exportCityMap(city, 53, 4), RangeError);
  });

  for (const [homes, hoods] of [
    [0, 1],
    [100, 5],
    [100, 8],
    [200, 5],
  ]) {
    test(`${homes} homes, ${hoods} neighbourhoods: exports every spot and crosswalk`, () => {
      const other: CityLayout = layoutCity(homes, hoods);
      const parsed = JSON.parse(exportCityMap(other, homes, hoods)) as CityMap;
      assert.equal(
        parsed.areas.reduce((sum, a) => sum + a.spots.length, 0),
        gatheringSpots(other.gathering).length,
      );
      assert.equal(parsed.crosswalks.length, other.crosswalks.length);
    });
  }
});

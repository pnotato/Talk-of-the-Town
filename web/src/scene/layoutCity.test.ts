/// <reference types="node" />
// Run: node --test web/src/scene/layoutCity.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type CityLayout, layoutCity, VEHICLE_LENGTH, VEHICLE_WIDTH } from "./layoutCity.ts";
import { TREE_RADIUS } from "./layoutTown.ts";
import { distanceToObstacle, insidePolygon, type Point } from "./mapLayout.ts";

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const EPS = 1e-6;

const CASES: [homes: number, neighbourhoods: number][] = [[53, 5]];
for (const homes of [0, 1, 2, 10, 53, 100, 200]) {
  for (let n = 1; n <= 8; n++) if (homes !== 53 || n !== 5) CASES.push([homes, n]);
}

// Footprint of something centred at (x, z), `width` along local x, turned by a multiple of 90°.
function rect(x: number, z: number, width: number, depth: number, rotationY = 0): Rect {
  const turned = Math.abs(Math.sin(rotationY)) > 0.5;
  const w = turned ? depth : width;
  const d = turned ? width : depth;
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

// Clear distance between two rectangles along x or z (negative when they overlap).
function gap(a: Rect, b: Rect): number {
  return Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minZ - a.maxZ, a.minZ - b.maxZ);
}

function inside(p: Point, r: Rect, margin = 0): boolean {
  return (
    p.x >= r.minX + margin - EPS &&
    p.x <= r.maxX - margin + EPS &&
    p.z >= r.minZ + margin - EPS &&
    p.z <= r.maxZ - margin + EPS
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.minX >= outer.minX - EPS &&
    inner.maxX <= outer.maxX + EPS &&
    inner.minZ >= outer.minZ - EPS &&
    inner.maxZ <= outer.maxZ + EPS
  );
}

const corners = (r: Rect): Point[] => [
  { x: r.minX, z: r.minZ },
  { x: r.maxX, z: r.minZ },
  { x: r.maxX, z: r.maxZ },
  { x: r.minX, z: r.maxZ },
];

function parts(city: CityLayout) {
  const buildings = city.buildings.map((b) => rect(b.x, b.z, b.width, b.depth));
  const roads = city.roads.map((r) => rect(r.x, r.z, r.width, r.depth));
  const blocks = city.blocks.map((b) => rect(b.x, b.z, b.width, b.depth));
  const furniture = city.furniture.map((f) => rect(f.x, f.z, f.width, f.depth, f.rotationY));
  const vehicles = city.vehicles.map((v) =>
    rect(v.x, v.z, VEHICLE_WIDTH, VEHICLE_LENGTH, v.rotationY),
  );
  const p = city.plaza;
  const plaza = rect(p.x, p.z, p.width, p.depth);
  return { buildings, roads, blocks, furniture, vehicles, plaza };
}

// On the paved strip of some block: inside the block, outside every building.
function onSidewalk(p: Point, city: CityLayout, margin = 0): boolean {
  const { blocks, buildings } = parts(city);
  return blocks.some((b) => inside(p, b, margin)) && !buildings.some((b) => inside(p, b, -margin));
}

describe("layoutCity", () => {
  test("same input gives the same plain-data city", () => {
    const a = layoutCity(53, 5);
    assert.deepEqual(layoutCity(53, 5), a);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
    assert.notDeepEqual(layoutCity(53, 4).homes, a.homes);
  });

  test("53 homes deal round-robin into 5 districts as 11, 11, 11, 10, 10", () => {
    const city = layoutCity(53, 5);
    const sizes = [0, 0, 0, 0, 0];
    for (const h of city.homes) sizes[h.neighbourhood]++;
    assert.deepEqual(sizes, [11, 11, 11, 10, 10]);
  });

  test("the plaza holds 100 blobs, a 1.8 hex cell (about 2.8 square units) each", () => {
    const { gathering } = layoutCity(53, 5);
    assert.ok(gathering.spots.length >= 100, `${gathering.spots.length} spots`);
  });

  test("screens face into the plaza and towards the default camera, never away", () => {
    const city = layoutCity(53, 5);
    assert.ok(city.screens.length >= 4);
    const { x, z } = city.plaza;
    for (const s of city.screens) {
      const facing = { x: Math.sin(s.rotationY), z: Math.cos(s.rotationY) };
      assert.ok(facing.x * (x - s.x) + facing.z * (z - s.z) > 0, "screen faces the plaza");
      assert.ok(facing.z > 0, "screen faces south, where the default camera is");
    }
  });

  test("rejects counts that are not whole numbers or have no neighbourhood", () => {
    assert.throws(() => layoutCity(-1, 5), RangeError);
    assert.throws(() => layoutCity(10.5, 5), RangeError);
    assert.throws(() => layoutCity(10, 0), RangeError);
  });

  for (const [homeCount, hoods] of CASES) {
    describe(`${homeCount} homes, ${hoods} neighbourhoods`, () => {
      const city = layoutCity(homeCount, hoods);
      const { buildings, roads, blocks, furniture, vehicles, plaza } = parts(city);

      test("homes are indexed in order and dealt round-robin", () => {
        assert.equal(city.homes.length, homeCount);
        assert.equal(city.neighbourhoods.length, hoods);
        city.homes.forEach((h, i) => {
          assert.equal(h.index, i);
          assert.equal(h.neighbourhood, i % hoods);
        });
        city.neighbourhoods.forEach((n, k) => {
          assert.equal(n.homeCount, city.homes.filter((h) => h.neighbourhood === k).length);
          assert.ok(
            city.blocks.some((b) => b.neighbourhood === k),
            `district ${k} has no block`,
          );
        });
      });

      test("all numbers are finite", () => {
        assert.ok(!JSON.stringify(city).includes("null"));
      });

      test("buildings stand apart, on their blocks, off the roads and the plaza", () => {
        for (let i = 0; i < buildings.length; i++) {
          assert.ok(
            blocks.some((b) => contains(b, buildings[i])),
            `building ${i} off its block`,
          );
          for (const r of roads) assert.ok(gap(buildings[i], r) >= 0, `building ${i} on a road`);
          assert.ok(gap(buildings[i], plaza) >= 0, `building ${i} in the plaza`);
          for (let j = i + 1; j < buildings.length; j++) {
            const g = gap(buildings[i], buildings[j]);
            assert.ok(g >= 0.9, `buildings ${i} and ${j} are ${g.toFixed(2)} apart`);
          }
        }
      });

      test("blocks and the plaza keep off the roads", () => {
        for (const b of [...blocks, plaza]) {
          for (const r of roads) assert.ok(gap(b, r) >= -EPS, "a block runs onto a road");
        }
      });

      test("every home door is on its building's wall and opens onto a sidewalk", () => {
        for (const h of city.homes) {
          const out = { x: Math.sin(h.facing), z: Math.cos(h.facing) };
          const step = { x: h.door.x + out.x * 0.8, z: h.door.z + out.z * 0.8 };
          assert.ok(onSidewalk(step, city), `home ${h.index} opens onto no sidewalk`);
          const behind = { x: h.door.x - out.x * 0.5, z: h.door.z - out.z * 0.5 };
          assert.ok(
            buildings.some((b) => inside(behind, b)),
            `home ${h.index}'s door has no building behind it`,
          );
          const district = city.blocks.filter((b) => b.neighbourhood === h.neighbourhood);
          assert.ok(
            district.some((b) => inside(h.door, rect(b.x, b.z, b.width, b.depth))),
            `home ${h.index} is outside its district`,
          );
        }
      });

      test("doors on one wall keep their spacing", () => {
        const doors = city.homes.map((h) => h.door);
        for (let i = 0; i < doors.length; i++) {
          for (let j = i + 1; j < doors.length; j++) {
            const d = Math.hypot(doors[i].x - doors[j].x, doors[i].z - doors[j].z);
            assert.ok(d >= 2.5, `doors ${i} and ${j} are ${d.toFixed(2)} apart`);
          }
        }
      });

      test("plaza furniture stands inside the plaza, apart", () => {
        const { outline } = city.gathering;
        furniture.forEach((f, i) => {
          for (const c of corners(f)) assert.ok(insidePolygon(c, outline), `item ${i} spills out`);
          for (let j = i + 1; j < furniture.length; j++) {
            assert.ok(gap(f, furniture[j]) >= 0.5, `items ${i} and ${j} touch`);
          }
        });
      });

      test("everyone fits on the plaza's standing spots, clear of the furniture", () => {
        const { spots, outline } = city.gathering;
        assert.ok(spots.length >= 2 * homeCount, `${spots.length} spots for ${homeCount} homes`);
        assert.ok(spots.length >= 100, "even a small city's plaza takes 100 blobs");
        for (const p of spots) {
          assert.ok(insidePolygon(p, outline));
          for (const f of city.furniture) {
            const box = { x: f.x, z: f.z, width: f.width, depth: f.depth, rotationY: f.rotationY };
            assert.ok(distanceToObstacle(p, { kind: "box", ...box }) >= 0.6 - EPS);
          }
        }
      });

      test("parked vehicles sit on the roadway, out of junctions and apart", () => {
        const junctions = roads.flatMap((a, i) =>
          roads.slice(i + 1).flatMap((b) => {
            const r = {
              minX: Math.max(a.minX, b.minX),
              maxX: Math.min(a.maxX, b.maxX),
              minZ: Math.max(a.minZ, b.minZ),
              maxZ: Math.min(a.maxZ, b.maxZ),
            };
            return r.minX < r.maxX && r.minZ < r.maxZ ? [r] : [];
          }),
        );
        vehicles.forEach((v, i) => {
          assert.ok(
            roads.some((r) => contains(r, v)),
            `vehicle ${i} is off the road`,
          );
          for (const j of junctions) assert.ok(gap(v, j) >= 1, `vehicle ${i} blocks a junction`);
          for (let k = i + 1; k < vehicles.length; k++) {
            assert.ok(gap(v, vehicles[k]) >= 0.5, `vehicles ${i} and ${k} touch`);
          }
        });
      });

      test("street lamps stand on sidewalks, clear of doors", () => {
        for (const lamp of city.lamps) {
          const onPlaza = insidePolygon(lamp, city.gathering.outline);
          assert.ok(onPlaza || onSidewalk(lamp, city, 0.2), "lamp is off the sidewalk");
          for (const h of city.homes) {
            assert.ok(
              Math.hypot(lamp.x - h.door.x, lamp.z - h.door.z) >= 1.5,
              "lamp blocks a door",
            );
          }
        }
      });

      test("trees keep off roads, buildings, the plaza and each other", () => {
        city.trees.forEach((t, i) => {
          const r = TREE_RADIUS * t.size;
          const canopy = rect(t.x, t.z, 2 * r, 2 * r);
          for (const b of buildings) assert.ok(gap(canopy, b) >= 0, `tree ${i} hits a building`);
          for (const road of roads) assert.ok(gap(canopy, road) >= 0, `tree ${i} is on a road`);
          assert.ok(!insidePolygon(t, city.gathering.outline), `tree ${i} is on the plaza`);
          for (let j = i + 1; j < city.trees.length; j++) {
            const u = city.trees[j];
            const d = Math.hypot(t.x - u.x, t.z - u.z);
            assert.ok(d >= r + TREE_RADIUS * u.size, `trees ${i} and ${j} overlap`);
          }
        });
      });

      test("screens hang on a building, above the doors", () => {
        const tallest = Math.max(...city.buildings.map((b) => b.height));
        for (const s of city.screens) {
          const along = { x: Math.cos(s.rotationY), z: -Math.sin(s.rotationY) };
          const ends = [-1, 1].map((k) => ({
            x: s.x + (along.x * k * s.width) / 2,
            z: s.z + (along.z * k * s.width) / 2,
          }));
          const touching = buildings.some((b) => inside(s, b, -0.3));
          assert.ok(touching, "screen is not mounted on a building");
          for (const p of [s, ...ends]) {
            assert.ok(!buildings.some((b) => inside(p, b)), "screen sinks into a building");
          }
          assert.ok(s.y - s.height / 2 >= 3.5, "screen hangs over the doors");
          assert.ok(s.y + s.height / 2 <= tallest, "screen pokes above the skyline");
        }
      });

      // Trees may stand in the fields outside the city; bounds frame the city itself.
      test("everything else lies inside the bounds", () => {
        const b = city.bounds;
        const all = [...buildings, ...roads, ...blocks, ...furniture, ...vehicles, plaza];
        for (const r of all) assert.ok(contains(b, r), "something spills out of the bounds");
        for (const h of city.homes) assert.ok(inside(h.door, b));
        for (const lamp of city.lamps) assert.ok(inside(lamp, b));
        for (const p of city.gathering.outline) assert.ok(inside(p, b));
      });
    });
  }
});

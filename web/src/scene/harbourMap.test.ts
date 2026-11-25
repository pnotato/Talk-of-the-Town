/// <reference types="node" />
// Run: node --test web/src/scene/harbourMap.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { harbourAreas, harbourMap, harbourWalkObstacles } from "./harbourMap.ts";
import { exportHarbourMap } from "./harbourMapExport.ts";
import { type Heading, sailAt } from "./harbourMotion.ts";
import {
  coastAt,
  HARBOUR_HOMES,
  HARBOUR_NEIGHBOURHOODS,
  type HarbourRect,
  homeTop,
  layoutHarbour,
  MAPLE_RADIUS,
  onLand,
  PINE_RADIUS,
} from "./layoutHarbour.ts";
import {
  BLOB_RADIUS,
  BLOB_REACH,
  type Box,
  distanceToBox,
  distanceToObstacle,
  distanceToOutline,
  gatheringSpots,
  insidePolygon,
  type Point,
  SPOT_SPACING,
} from "./mapLayout.ts";
import { boxCorners } from "./townMap.ts";

const EPS = 1e-6;
const harbour = layoutHarbour(HARBOUR_HOMES, HARBOUR_NEIGHBOURHOODS);
const map = harbourMap(harbour);

const rectBox = (r: HarbourRect): Box => ({ ...r, rotationY: 0 });

// Whether two turned boxes overlap, by the separating axis test on their corners.
function overlaps(a: Box, b: Box, gap = 0): boolean {
  for (const box of [a, b]) {
    for (const angle of [box.rotationY, box.rotationY + Math.PI / 2]) {
      const axis = { x: Math.cos(angle), z: -Math.sin(angle) };
      const span = (c: Box) => {
        const along = boxCorners(c).map((p) => p.x * axis.x + p.z * axis.z);
        return [Math.min(...along), Math.max(...along)];
      };
      const [a0, a1] = span(a);
      const [b0, b1] = span(b);
      if (a1 + gap <= b0 || b1 + gap <= a0) return false;
    }
  }
  return true;
}

/** Open water a boat can float in: off the land, the decks, the barge and the lighthouse's rock. */
function inOpenWater(p: Point, margin: number): boolean {
  if (!(p.z < coastAt(harbour.coast, p.x) - margin)) return false;
  const decks = [harbour.pier, harbour.pierhead, harbour.wheel.platform, harbour.boardwalk];
  if (decks.some((d) => distanceToBox(p.x, p.z, rectBox(d)) < margin + 0.6)) return false;
  if (distanceToBox(p.x, p.z, harbour.screen.barge) < margin) return false;
  const { lighthouse, breakwater } = harbour;
  if (Math.hypot(p.x - lighthouse.x, p.z - lighthouse.z) < lighthouse.island + margin) return false;
  const { from, to, width } = breakwater;
  const d = distanceToOutline(p, [from, to]);
  return d >= width / 2 + 1 + margin;
}

describe("layoutHarbour", () => {
  test("is the same harbour every time", () => {
    assert.deepEqual(layoutHarbour(HARBOUR_HOMES, HARBOUR_NEIGHBOURHOODS), harbour);
  });

  test("the coast runs west to east, straight along the sea wall under the boardwalk", () => {
    const { coast, boardwalk } = harbour;
    for (let i = 1; i < coast.length; i++) assert.ok(coast[i].x > coast[i - 1].x);
    for (let x = boardwalk.x - boardwalk.width / 2; x <= boardwalk.x + boardwalk.width / 2; x++) {
      assert.equal(coastAt(coast, x), boardwalk.z - boardwalk.depth / 2);
    }
  });

  test("the green and the boardwalk are on land; the pier and the pier head are over water", () => {
    for (const r of [harbour.green, harbour.boardwalk]) {
      for (const p of boxCorners(rectBox(r))) assert.ok(onLand(harbour.coast, p, -EPS));
    }
    for (const r of [harbour.pier, harbour.pierhead, harbour.wheel.platform]) {
      const far = { x: r.x, z: r.z - r.depth / 2 };
      assert.ok(!onLand(harbour.coast, far));
    }
  });

  test("53 homes in 5 neighbourhoods, dealt round-robin, none touching", () => {
    assert.equal(harbour.homes.length, 53);
    harbour.homes.forEach((h, i) => {
      assert.equal(h.index, i);
      assert.equal(h.neighbourhood, i % 5);
    });
    assert.deepEqual(
      harbour.neighbourhoods.map((n) => n.homeCount),
      [11, 11, 11, 10, 10],
    );
    for (let i = 0; i < harbour.homes.length; i++) {
      for (let j = i + 1; j < harbour.homes.length; j++) {
        assert.ok(!overlaps(harbour.homes[i], harbour.homes[j], 0.5), `homes ${i} and ${j}`);
      }
    }
  });

  test("homes, stalls and trees stand on land, clear of the walkable areas and the lanes", () => {
    const areas = harbourAreas(harbour).map((a) => rectBox(a.rect));
    const lanes = harbour.lanes.map(rectBox);
    for (const h of harbour.homes) {
      for (const p of boxCorners(h)) assert.ok(onLand(harbour.coast, p, 1), `home ${h.index}`);
      for (const other of [...areas, ...lanes]) assert.ok(!overlaps(h, other, 0.5));
      assert.ok(homeTop(h) > h.wallHeight);
    }
    for (const s of harbour.stalls) {
      for (const a of [...areas, ...lanes]) assert.ok(!overlaps(s, a));
    }
    for (const t of harbour.picnics) {
      for (const p of boxCorners(t)) assert.ok(onLand(harbour.coast, p, 1));
      for (const a of [...areas, ...lanes, ...harbour.stalls]) assert.ok(!overlaps(t, a, 0.5));
    }
    for (const t of harbour.trees) {
      const radius = (t.kind === "pine" ? PINE_RADIUS : MAPLE_RADIUS) * t.size;
      assert.ok(onLand(harbour.coast, t, radius), `tree at ${t.x}, ${t.z} is in the water`);
      for (const h of harbour.homes) assert.ok(distanceToBox(t.x, t.z, h) >= radius);
    }
  });

  // A hull afloat: every point down its keel, bow to stern, is half its beam clear of anything.
  const afloat = (at: Heading, length: number, beam: number) => {
    for (let k = -0.5; k <= 0.5; k += 0.125) {
      const p = {
        x: at.x + Math.sin(at.heading) * k * length,
        z: at.z + Math.cos(at.heading) * k * length,
      };
      if (!inOpenWater(p, beam / 2)) return false;
    }
    return true;
  };
  const BEAM = { dinghy: 1.3, fishing: 1.9, sail: 1.9 };

  test("boats moor in open water, and every sailboat's lap stays in it", () => {
    const at: Heading = { x: 0, z: 0, heading: 0 };
    for (const boat of harbour.boats) {
      assert.ok(afloat(boat, boat.length, BEAM[boat.kind]), `${boat.kind} at ${boat.x}, ${boat.z}`);
      if (!boat.loop) continue;
      const through = Math.hypot(boat.x - boat.loop.x, boat.z - boat.loop.z);
      assert.ok(Math.abs(through - boat.loop.radius) < EPS, "the lap passes the mooring");
      for (let u = 0; u <= 1; u += 0.005) {
        sailAt({ ...boat, loop: boat.loop }, u, at);
        assert.ok(
          afloat(at, boat.length, BEAM.sail),
          `sailboat ${boat.colour} runs aground at ${u}`,
        );
        for (const other of harbour.boats) {
          if (other === boat) continue;
          const gap = Math.hypot(at.x - other.x, at.z - other.z) - (boat.length + other.length) / 2;
          assert.ok(gap > 0.5, `sailboat ${boat.colour} hits a moored boat at ${u}`);
        }
      }
    }
  });
});

describe("harbourMap", () => {
  test("four walkable areas, the green first, each touching the one before it", () => {
    const names = map.gathering.areas.map((a) => a.name);
    assert.deepEqual(names, ["green", "boardwalk", "pier", "pierhead"]);
    const rects = harbourAreas(harbour).map((a) => a.rect);
    const touches = (a: HarbourRect, b: HarbourRect) =>
      Math.abs(a.z - b.z) <= (a.depth + b.depth) / 2 + EPS &&
      Math.abs(a.x - b.x) <= (a.width + b.width) / 2 + EPS;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        assert.ok(!overlaps(rectBox(rects[i]), rectBox(rects[j]), -EPS), `areas ${i}, ${j}`);
      }
    }
    // The green and the pier both meet the boardwalk; the pier head meets the pier.
    assert.ok(touches(rects[0], rects[1]));
    assert.ok(touches(rects[2], rects[1]));
    assert.ok(touches(rects[3], rects[2]));
  });

  test("room for 100 blobs many times over, every spot clear of everything", () => {
    const spots = gatheringSpots(map.gathering);
    assert.ok(spots.length >= 600, `only ${spots.length} spots`);
    const obstacles = harbourWalkObstacles(harbour).map((o) => o.obstacle);
    for (const area of map.gathering.areas) {
      assert.ok(area.spots.length >= 40, `${area.name} has ${area.spots.length} spots`);
      for (const s of area.spots) {
        assert.ok(insidePolygon(s, area.outline));
        assert.ok(distanceToOutline(s, area.outline) >= BLOB_RADIUS - EPS);
        for (const o of obstacles) assert.ok(distanceToObstacle(s, o) >= BLOB_REACH - EPS);
      }
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const d = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
        assert.ok(d >= 2 * BLOB_RADIUS - EPS, `spots ${i} and ${j} are ${d} apart`);
      }
    }
  });

  test("the camera keeps out of the landmarks, and the default view shows their tops", () => {
    const { wheel, lighthouse } = harbour;
    const wheelTop = wheel.hub + wheel.radius;
    assert.ok(
      map.solids.some((s) => s.height > wheelTop && distanceToBox(wheel.x, wheel.z, s) === 0),
    );
    assert.ok(map.frame.some((p) => p.y > wheelTop));
    assert.ok(map.frame.some((p) => p.y >= lighthouse.height && p.x > lighthouse.x - 3));
    assert.equal(map.height, Math.max(...map.solids.map((s) => s.height)));
  });

  test("homes keep their index and neighbourhood, with the door mid-front facing out", () => {
    map.homes.forEach((h, i) => {
      const home = harbour.homes[i];
      assert.equal(h.index, i);
      assert.equal(h.neighbourhood, i % 5);
      const out = { x: h.door.x - home.x, z: h.door.z - home.z };
      assert.ok(Math.abs(Math.hypot(out.x, out.z) - home.depth / 2) < EPS);
    });
  });
});

describe("exportHarbourMap", () => {
  const file = JSON.parse(exportHarbourMap(harbour, HARBOUR_HOMES, HARBOUR_NEIGHBOURHOODS)) as {
    version: number;
    blobRadius: number;
    spotSpacing: number;
    areas: { name: string; rect: { minX: number; maxX: number; minZ: number; maxZ: number } }[];
    crosswalks: unknown[];
    boxes: unknown[];
    discs: unknown[];
  };

  test("is version 1 with the four areas as rectangles", () => {
    assert.equal(file.version, 1);
    assert.equal(file.blobRadius, BLOB_RADIUS);
    assert.equal(file.spotSpacing, SPOT_SPACING);
    assert.deepEqual(file.crosswalks, []);
    file.areas.forEach((a, i) => {
      const { name, rect } = harbourAreas(harbour)[i];
      assert.equal(a.name, name);
      assert.deepEqual(a.rect, {
        minX: rect.x - rect.width / 2,
        maxX: rect.x + rect.width / 2,
        minZ: rect.z - rect.depth / 2,
        maxZ: rect.z + rect.depth / 2,
      });
    });
    assert.equal(file.boxes.length + file.discs.length, harbourWalkObstacles(harbour).length);
  });
});

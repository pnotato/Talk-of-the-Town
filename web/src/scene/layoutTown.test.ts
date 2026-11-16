/// <reference types="node" />
// Run: node --test web/src/scene/layoutTown.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HOME_DEPTH,
  HOME_WIDTH,
  layoutTown,
  type TownHome,
  type TownLayout,
  type TownPath,
} from "./layoutTown.ts";

type Point = { x: number; z: number };

const EPS = 1e-9;
// Minimum clear ground between any two homes, and between a home and a path or the square.
const MIN_GAP = 0.5;

const CASES: [homes: number, neighbourhoods: number][] = [[53, 5]];
for (const homes of [0, 1, 2, 10, 53, 100, 200]) {
  for (let n = 1; n <= 8; n++) if (homes !== 53 || n !== 5) CASES.push([homes, n]);
}

// Front (door side) of a home: rotationY turns local +z to face the street.
function front(h: TownHome): Point {
  return { x: Math.sin(h.rotationY), z: Math.cos(h.rotationY) };
}

function corners(h: TownHome): Point[] {
  const f = front(h);
  const side = { x: f.z, z: -f.x };
  const w = HOME_WIDTH / 2;
  const d = HOME_DEPTH / 2;
  return [
    [w, d],
    [-w, d],
    [-w, -d],
    [w, -d],
  ].map(([s, t]) => ({ x: h.x + side.x * s + f.x * t, z: h.z + side.z * s + f.z * t }));
}

// Largest gap along any separating axis. Never more than the true distance between the
// rectangles, so asserting it >= MIN_GAP is a safe (conservative) no-overlap check.
function separation(a: Point[], b: Point[]): number {
  let best = -Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const ax = { x: -(q.z - p.z) / len, z: (q.x - p.x) / len };
      const pa = a.map((c) => c.x * ax.x + c.z * ax.z);
      const pb = b.map((c) => c.x * ax.x + c.z * ax.z);
      const gap = Math.max(Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
      best = Math.max(best, gap);
    }
  }
  return best;
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function insidePolygon(p: Point, poly: Point[]): boolean {
  const signs = poly.map((c, i) => Math.sign(cross(c, poly[(i + 1) % poly.length], p)));
  return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
}

function polygonSegmentDistance(poly: Point[], a: Point, b: Point): number {
  if (insidePolygon(a, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (segmentsCross(p, q, a, b)) return 0;
    best = Math.min(
      best,
      pointSegmentDistance(p, a, b),
      pointSegmentDistance(q, a, b),
      pointSegmentDistance(a, p, q),
      pointSegmentDistance(b, p, q),
    );
  }
  return best;
}

// Nearest and farthest distance from point c to any part of the polygon.
function distanceRange(poly: Point[], c: Point): [number, number] {
  const far = Math.max(...poly.map((p) => Math.hypot(p.x - c.x, p.z - c.z)));
  if (insidePolygon(c, poly)) return [0, far];
  const near = Math.min(
    ...poly.map((p, i) => pointSegmentDistance(c, p, poly[(i + 1) % poly.length])),
  );
  return [near, far];
}

// Clear ground between a home and a path (negative when they overlap).
function clearance(poly: Point[], path: TownPath): number {
  if (path.kind === "line") {
    const d = polygonSegmentDistance(poly, { x: path.x1, z: path.z1 }, { x: path.x2, z: path.z2 });
    return d - path.width / 2;
  }
  const [near, far] = distanceRange(poly, path);
  return Math.max(near - (path.radius + path.width / 2), path.radius - path.width / 2 - far);
}

function onPath(p: Point, path: TownPath): boolean {
  if (path.kind === "line") {
    const d = pointSegmentDistance(p, { x: path.x1, z: path.z1 }, { x: path.x2, z: path.z2 });
    return d <= path.width / 2;
  }
  return Math.abs(Math.hypot(p.x - path.x, p.z - path.z) - path.radius) <= path.width / 2;
}

function inBounds(layout: TownLayout, p: Point): boolean {
  const b = layout.bounds;
  return (
    p.x >= b.minX - EPS && p.x <= b.maxX + EPS && p.z >= b.minZ - EPS && p.z <= b.maxZ + EPS
  );
}

function discInBounds(layout: TownLayout, c: Point, r: number): boolean {
  return inBounds(layout, { x: c.x - r, z: c.z - r }) && inBounds(layout, { x: c.x + r, z: c.z + r });
}

describe("layoutTown", () => {
  test("same input gives the same plain-data layout", () => {
    const a = layoutTown(53, 5);
    assert.deepEqual(layoutTown(53, 5), a);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  });

  test("different inputs give different layouts", () => {
    assert.notDeepEqual(layoutTown(53, 5).homes, layoutTown(53, 4).homes);
  });

  test("53 homes in 5 neighbourhoods deal round-robin as 11, 11, 11, 10, 10", () => {
    const layout = layoutTown(53, 5);
    const sizes = [0, 0, 0, 0, 0];
    for (const h of layout.homes) sizes[h.neighbourhood]++;
    assert.deepEqual(sizes, [11, 11, 11, 10, 10]);
    assert.deepEqual(
      layout.neighbourhoods.map((n) => n.homeCount),
      [11, 11, 11, 10, 10],
    );
  });

  test("the square holds 100 gathered blobs around its fountain", () => {
    const { square } = layoutTown(53, 5);
    const perBlob = 3; // ground per standing blob, with room to talk
    const free = Math.PI * (square.radius ** 2 - square.fountainRadius ** 2);
    assert.ok(free >= 100 * perBlob, `free area ${free.toFixed(0)}`);
  });

  test("rejects counts that are not whole numbers or have no neighbourhood", () => {
    assert.throws(() => layoutTown(-1, 5), RangeError);
    assert.throws(() => layoutTown(10.5, 5), RangeError);
    assert.throws(() => layoutTown(10, 0), RangeError);
    assert.throws(() => layoutTown(10, 2.5), RangeError);
  });

  for (const [homeCount, hoods] of CASES) {
    describe(`${homeCount} homes, ${hoods} neighbourhoods`, () => {
      const layout = layoutTown(homeCount, hoods);
      const shapes = layout.homes.map(corners);

      test("homes are indexed in order and dealt round-robin", () => {
        assert.equal(layout.homes.length, homeCount);
        assert.equal(layout.neighbourhoods.length, hoods);
        layout.homes.forEach((h, i) => {
          assert.equal(h.index, i);
          assert.equal(h.neighbourhood, i % hoods);
        });
        layout.neighbourhoods.forEach((n, k) => {
          assert.equal(n.index, k);
          assert.equal(n.homeCount, layout.homes.filter((h) => h.neighbourhood === k).length);
          assert.ok(n.homeCount >= Math.floor(homeCount / hoods));
          assert.ok(n.homeCount <= Math.ceil(homeCount / hoods));
        });
      });

      test("all numbers are finite", () => {
        // JSON turns NaN and Infinity into null.
        assert.ok(!JSON.stringify(layout).includes("null"));
      });

      test("homes keep clear of each other", () => {
        for (let i = 0; i < shapes.length; i++) {
          for (let j = i + 1; j < shapes.length; j++) {
            const gap = separation(shapes[i], shapes[j]);
            assert.ok(gap >= MIN_GAP, `homes ${i} and ${j} are ${gap.toFixed(2)} apart`);
          }
        }
      });

      test("no home sits in the square", () => {
        const { square } = layout;
        shapes.forEach((s, i) => {
          const [near] = distanceRange(s, square);
          assert.ok(near >= square.radius + MIN_GAP, `home ${i} is ${near.toFixed(2)} from centre`);
        });
      });

      test("no home sits on a path", () => {
        shapes.forEach((s, i) => {
          layout.paths.forEach((p, j) => {
            const gap = clearance(s, p);
            assert.ok(gap >= MIN_GAP / 2, `home ${i} is ${gap.toFixed(2)} from path ${j}`);
          });
        });
      });

      test("every home faces a street", () => {
        layout.homes.forEach((h) => {
          const f = front(h);
          const reach = HOME_DEPTH / 2 + 1.2;
          const doorstep = { x: h.x + f.x * reach, z: h.z + f.z * reach };
          assert.ok(
            layout.paths.some((p) => onPath(doorstep, p)),
            `home ${h.index} faces no street`,
          );
        });
      });

      test("a path runs from the square to each neighbourhood", () => {
        const { square } = layout;
        for (const n of layout.neighbourhoods) {
          const linked = layout.paths.some(
            (p) =>
              p.kind === "line" &&
              Math.hypot(p.x1 - square.x, p.z1 - square.z) < square.radius &&
              Math.hypot(p.x2 - n.x, p.z2 - n.z) < n.radius,
          );
          assert.ok(linked, `neighbourhood ${n.index} is not linked to the square`);
        }
      });

      test("neighbourhoods keep apart from each other and the square", () => {
        const { square, neighbourhoods } = layout;
        neighbourhoods.forEach((a, i) => {
          const toSquare = Math.hypot(a.x - square.x, a.z - square.z);
          assert.ok(toSquare >= a.radius + square.radius, `neighbourhood ${i} overlaps the square`);
          neighbourhoods.slice(i + 1).forEach((b, j) => {
            const d = Math.hypot(a.x - b.x, a.z - b.z);
            assert.ok(d >= a.radius + b.radius, `neighbourhoods ${i} and ${i + j + 1} overlap`);
          });
        });
      });

      test("homes stay inside their neighbourhood", () => {
        shapes.forEach((s, i) => {
          const n = layout.neighbourhoods[layout.homes[i].neighbourhood];
          const [, far] = distanceRange(s, n);
          assert.ok(far <= n.radius, `home ${i} spills out of neighbourhood ${n.index}`);
        });
      });

      test("everything lies inside the bounds", () => {
        const { square, neighbourhoods, paths } = layout;
        assert.ok(discInBounds(layout, square, square.radius));
        for (const n of neighbourhoods) assert.ok(discInBounds(layout, n, n.radius));
        for (const s of shapes) for (const c of s) assert.ok(inBounds(layout, c));
        for (const p of paths) {
          if (p.kind === "ring") assert.ok(discInBounds(layout, p, p.radius + p.width / 2));
          else
            assert.ok(inBounds(layout, { x: p.x1, z: p.z1 }) && inBounds(layout, { x: p.x2, z: p.z2 }));
        }
      });
    });
  }
});

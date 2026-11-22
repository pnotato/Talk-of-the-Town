/// <reference types="node" />
// Run: node --test web/src/scene/layoutTown.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HOME_TOP,
  layoutTown,
  SIDEWALK,
  TREE_HEIGHT,
  TREE_RADIUS,
  type TownBlock,
  type TownHome,
  type TownLayout,
  type TownRect,
} from "./layoutTown.ts";
import { type Box, distanceToBox, type Point } from "./mapLayout.ts";

const EPS = 1e-6;
// Clear ground between two homes, and between a home and anything else built.
const MIN_GAP = 0.5;
// Clear ground between a tree's canopy and anything built or another canopy.
const TREE_GAP = 0.2;

const CASES: [homes: number, neighbourhoods: number][] = [[53, 5]];
for (const homes of [0, 1, 2, 10, 53, 100, 200]) {
  for (let n = 1; n <= 8; n++) if (homes !== 53 || n !== 5) CASES.push([homes, n]);
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const edges = (r: TownRect): Rect => ({
  minX: r.x - r.width / 2,
  maxX: r.x + r.width / 2,
  minZ: r.z - r.depth / 2,
  maxZ: r.z + r.depth / 2,
});

// A block's ground inside its sidewalk; the square is paving to its edge.
function innerOf(b: TownBlock): Rect {
  const r = edges(b);
  const s = b.kind === "square" ? 0 : SIDEWALK;
  return { minX: r.minX + s, maxX: r.maxX - s, minZ: r.minZ + s, maxZ: r.maxZ - s };
}

function insideRect(p: Point, r: Rect, margin = 0): boolean {
  return (
    p.x >= r.minX + margin - EPS &&
    p.x <= r.maxX - margin + EPS &&
    p.z >= r.minZ + margin - EPS &&
    p.z <= r.maxZ - margin + EPS
  );
}

// Clear distance between two axis-aligned rectangles (negative when they overlap).
function rectGap(a: Rect, b: Rect): number {
  return Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minZ - a.maxZ, a.minZ - b.maxZ);
}

function corners(b: Box): Point[] {
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  return [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([u, v]) => {
    const lx = (u * b.width) / 2;
    const lz = (v * b.depth) / 2;
    // three.js rotation.y: local (lx, lz) to world.
    return { x: b.x + c * lx + s * lz, z: b.z - s * lx + c * lz };
  });
}

const rectBox = (r: Rect): Box => ({
  x: (r.minX + r.maxX) / 2,
  z: (r.minZ + r.maxZ) / 2,
  width: r.maxX - r.minX,
  depth: r.maxZ - r.minZ,
  rotationY: 0,
});

// Largest gap along any separating axis: never more than the true distance between two
// convex polygons, so asserting it >= a gap is a safe no-overlap check.
function separation(a: Point[], b: Point[]): number {
  let best = -Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const ax = { x: -(q.z - p.z) / len, z: (q.x - p.x) / len };
      const pa = a.map((v) => v.x * ax.x + v.z * ax.z);
      const pb = b.map((v) => v.x * ax.x + v.z * ax.z);
      best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    }
  }
  return best;
}

const boxGap = (a: Box, b: Box) => separation(corners(a), corners(b));

const facing = (h: TownHome): Point => ({ x: Math.sin(h.rotationY), z: Math.cos(h.rotationY) });

function doorOf(h: TownHome): Point {
  const f = facing(h);
  return { x: h.x + (f.x * h.depth) / 2, z: h.z + (f.z * h.depth) / 2 };
}

// Everything built that stands on the ground, as boxes.
function builtBoxes(layout: TownLayout): { what: string; box: Box }[] {
  return [
    ...layout.homes.map((h, i) => ({ what: `home ${i}`, box: h as Box })),
    ...layout.buildings.map((b, i) => ({ what: `${b.kind} ${i}`, box: b as Box })),
    { what: "screen", box: layout.screen.footprint },
    ...layout.props.map((p, i) => ({ what: `${p.kind} ${i}`, box: p as Box })),
  ];
}

// Union-find over rectangles that overlap or share a length of edge (not just a corner).
function components(rects: Rect[]): number[] {
  const parent = rects.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const joined = (a: Rect, b: Rect) => {
    const gx = Math.max(b.minX - a.maxX, a.minX - b.maxX);
    const gz = Math.max(b.minZ - a.maxZ, a.minZ - b.maxZ);
    return (gx <= EPS && gz < -EPS) || (gz <= EPS && gx < -EPS);
  };
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (joined(rects[i], rects[j])) parent[find(i)] = find(j);
    }
  }
  return rects.map((_, i) => find(i));
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

  test("the town has a square, a town hall north of it and a main street of shops", () => {
    const layout = layoutTown(53, 5);
    const square = layout.blocks.filter((b) => b.kind === "square");
    assert.equal(square.length, 1);
    assert.deepEqual(edges(square[0]), edges(layout.square));
    const [hall] = layout.buildings.filter((b) => b.kind === "townHall");
    assert.ok(hall, "no town hall");
    assert.ok(hall.z < layout.square.z - layout.square.depth / 2, "town hall is not north");
    assert.ok(Math.abs(hall.x - layout.square.x) < EPS, "town hall is not centred on the square");
    // Faces south, across the street onto the square.
    assert.ok(Math.abs(Math.cos(hall.rotationY) - 1) < EPS);
    const shops = layout.buildings.filter((b) => b.kind === "shop");
    assert.ok(shops.length >= 20, `only ${shops.length} shops`);
    // Main Street runs along the square's south side, shops facing it from both sides.
    const main = layout.streets.filter((s) => s.main);
    assert.ok(main.length > 0);
    const mainZ = main[0].z;
    assert.ok(main.every((s) => Math.abs(s.z - mainZ) < EPS));
    assert.ok(Math.abs(mainZ - main[0].depth / 2 - edges(layout.square).maxZ) < EPS);
    const front = (b: (typeof shops)[number]) => ({
      x: b.x + (Math.sin(b.rotationY) * b.depth) / 2,
      z: b.z + (Math.cos(b.rotationY) * b.depth) / 2,
    });
    const onMain = (sign: number) =>
      shops.filter((b) => {
        const f = front(b);
        return Math.abs(Math.cos(b.rotationY) + sign) < EPS && Math.abs(f.z - mainZ) < 5;
      });
    assert.ok(onMain(1).length >= 6, "too few shops on Main Street's south side");
    assert.ok(onMain(-1).length >= 2, "too few shops on Main Street's north side");
    // Shops face the square across its east and west streets.
    for (const side of [-1, 1]) {
      const facingSquare = shops.filter(
        (b) => Math.abs(Math.sin(b.rotationY) + side) < EPS && Math.sign(b.x) === side,
      );
      assert.ok(facingSquare.length >= 3, `too few shops face the square from ${side}`);
    }
  });

  test("one news screen stands in the square, facing south over it to the default camera", () => {
    const { screen, square } = layoutTown(53, 5);
    const sq = edges(square);
    for (const c of corners(screen.footprint)) assert.ok(insideRect(c, sq, 0.3));
    assert.ok(Math.abs(screen.panel.rotationY) < EPS, "screen does not face south");
    assert.ok(screen.panel.z < square.z, "screen is not on the square's north side");
    // Big, and its bottom over the heads of a crowd of 1-unit blobs.
    assert.ok(screen.panel.width >= 7);
    assert.ok(screen.panel.y - screen.panel.height / 2 >= 1.8);
    assert.ok(Math.abs(screen.panel.width / screen.panel.height - 16 / 9) < 0.01);
  });

  test("trees stand in the fields around the town, not only inside it", () => {
    const layout = layoutTown(53, 5);
    const b = edges({
      x: (layout.bounds.minX + layout.bounds.maxX) / 2,
      z: (layout.bounds.minZ + layout.bounds.maxZ) / 2,
      width: layout.bounds.maxX - layout.bounds.minX,
      depth: layout.bounds.maxZ - layout.bounds.minZ,
    });
    const out = layout.trees.filter((t) => !insideRect(t, b));
    assert.ok(out.length >= 30, `only ${out.length} trees in the fields`);
  });

  test("homes vary in size, roof and colour seed, and sit a little off the grid", () => {
    const { homes } = layoutTown(53, 5);
    assert.ok(new Set(homes.map((h) => h.width.toFixed(2))).size > 10);
    assert.ok(new Set(homes.map((h) => h.roof)).size === 2);
    assert.ok(homes.some((h) => Math.abs(Math.sin(h.rotationY)) > 0.005));
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
      const built = builtBoxes(layout);
      const blockRects = layout.blocks.map(edges);
      const streets = layout.streets.filter((s) => !s.out).map(edges);

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

      test("blocks and streets never overlap; every block is ringed by streets", () => {
        for (let i = 0; i < blockRects.length; i++) {
          for (let j = i + 1; j < blockRects.length; j++) {
            assert.ok(rectGap(blockRects[i], blockRects[j]) >= 3, `blocks ${i}, ${j} overlap`);
          }
          streets.forEach((s, j) => {
            assert.ok(rectGap(blockRects[i], s) >= -EPS, `block ${i} overlaps street ${j}`);
          });
          // Just past each side of the block, all along it, is street.
          const r = blockRects[i];
          const sides = [
            (t: number) => ({ x: r.minX + t * (r.maxX - r.minX), z: r.minZ - 0.5 }),
            (t: number) => ({ x: r.minX + t * (r.maxX - r.minX), z: r.maxZ + 0.5 }),
            (t: number) => ({ x: r.minX - 0.5, z: r.minZ + t * (r.maxZ - r.minZ) }),
            (t: number) => ({ x: r.maxX + 0.5, z: r.minZ + t * (r.maxZ - r.minZ) }),
          ];
          // From just past one corner to just past the next, so the junctions count too.
          for (const side of sides) {
            for (let t = -0.05; t <= 1.05; t += 0.1) {
              const p = side(t);
              assert.ok(
                streets.some((s) => insideRect(p, s)),
                `block ${i} has no street at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`,
              );
            }
          }
        }
      });

      test("the streets are one network, joined to the square", () => {
        const roots = components(streets);
        assert.equal(new Set(roots).size, 1, "streets fall apart into pieces");
        assert.ok(
          streets.some((s) => rectGap(s, edges(layout.square)) <= EPS),
          "no street reaches the square",
        );
      });

      test("homes keep clear of each other", () => {
        const homes = layout.homes.map((h) => corners(h));
        for (let i = 0; i < homes.length; i++) {
          for (let j = i + 1; j < homes.length; j++) {
            const gap = separation(homes[i], homes[j]);
            assert.ok(gap >= MIN_GAP, `homes ${i} and ${j} are ${gap.toFixed(2)} apart`);
          }
        }
      });

      test("homes stand on their own neighbourhood's blocks, off the sidewalks", () => {
        layout.homes.forEach((h, i) => {
          const block = layout.blocks.find((b) => insideRect(h, edges(b)));
          assert.ok(block, `home ${i} is on no block`);
          assert.equal(block.kind, "homes");
          assert.equal(block.neighbourhood, h.neighbourhood);
          for (const c of corners(h)) {
            assert.ok(insideRect(c, innerOf(block), 0.2), `home ${i} is on the sidewalk`);
          }
        });
      });

      test("nothing built overlaps anything else", () => {
        for (let i = 0; i < built.length; i++) {
          for (let j = i + 1; j < built.length; j++) {
            const a = built[i];
            const b = built[j];
            // Shops in a row share party walls; everything else keeps a gap.
            const touching = a.what.startsWith("shop") && b.what.startsWith("shop");
            const gap = boxGap(a.box, b.box);
            const need = touching ? -EPS : a.what.startsWith("home") ? MIN_GAP : 0.3;
            assert.ok(gap >= need, `${a.what} and ${b.what} are ${gap.toFixed(2)} apart`);
          }
        }
      });

      test("buildings, the screen and props stand inside their blocks, off the sidewalks", () => {
        for (const { what, box } of built) {
          const centre = { x: box.x, z: box.z };
          const block = layout.blocks.find((b) => insideRect(centre, edges(b)));
          assert.ok(block, `${what} is on no block`);
          for (const c of corners(box)) {
            assert.ok(insideRect(c, innerOf(block)), `${what} spills off its block's ground`);
          }
        }
      });

      test("every door faces its sidewalk, with a clear front walk to it", () => {
        layout.homes.forEach((h, i) => {
          const door = doorOf(h);
          const block = layout.blocks.find((b) => insideRect(h, edges(b))) as TownBlock;
          const inner = innerOf(block);
          const f = facing(h);
          // Straight out of the door, the first ground that is not the lawn is sidewalk.
          const setback = Math.min(
            f.z < -0.9 ? door.z - inner.minZ : Infinity,
            f.z > 0.9 ? inner.maxZ - door.z : Infinity,
            f.x < -0.9 ? door.x - inner.minX : Infinity,
            f.x > 0.9 ? inner.maxX - door.x : Infinity,
          );
          assert.ok(setback < 2.5, `home ${i} does not face a sidewalk (${setback.toFixed(2)})`);
          const kerb = { x: door.x + f.x * (setback + 0.1), z: door.z + f.z * (setback + 0.1) };
          assert.ok(insideRect(kerb, edges(block)) && !insideRect(kerb, inner, 0.01));
          const walk = edges(layout.walks[i]);
          assert.ok(insideRect(door, walk, -0.1), `home ${i}'s walk misses its door`);
          assert.ok(
            Math.min(
              Math.abs(walk.minZ - inner.minZ),
              Math.abs(walk.maxZ - inner.maxZ),
              Math.abs(walk.minX - inner.minX),
              Math.abs(walk.maxX - inner.maxX),
            ) < EPS,
            `home ${i}'s walk stops short of the sidewalk`,
          );
          const walkBox = rectBox(walk);
          for (const other of built) {
            if (other.what === `home ${i}`) continue;
            assert.ok(boxGap(walkBox, other.box) >= 0, `home ${i}'s walk runs into ${other.what}`);
          }
        });
      });

      test("each neighbourhood's blocks cluster together", () => {
        layout.neighbourhoods.forEach((n) => {
          if (n.homeCount === 0) return;
          const mine = layout.blocks.filter(
            (b) => b.kind === "homes" && b.neighbourhood === n.index,
          );
          assert.ok(mine.length > 0);
          // Blocks across a street (or a corner) from each other are neighbours; all must join.
          const rects = mine.map(edges).map((r) => ({
            minX: r.minX - 3,
            maxX: r.maxX + 3,
            minZ: r.minZ - 3,
            maxZ: r.maxZ + 3,
          }));
          assert.equal(new Set(components(rects)).size, 1, `neighbourhood ${n.index} is split`);
          // And they huddle round its centre rather than straggle: no home is further from it
          // than 1.6 times the side of a square of the same ground. (An L of blocks round a
          // corner of town is about 1.4; a straight run of ten blocks would be over 2.)
          const ground = mine.reduce((s, b) => s + b.width * b.depth, 0);
          for (const h of layout.homes.filter((h) => h.neighbourhood === n.index)) {
            const far = Math.hypot(h.x - n.x, h.z - n.z);
            assert.ok(far <= 1.6 * Math.sqrt(ground), `home ${h.index} straggles from its centre`);
          }
        });
      });

      test("trees keep clear of everything built, the streets, the sidewalks and each other", () => {
        const { trees } = layout;
        const kerbs = layout.blocks.map((b) => ({ outer: edges(b), inner: innerOf(b) }));
        trees.forEach((t, i) => {
          const r = TREE_RADIUS * t.size;
          for (const { what, box } of built) {
            const d = distanceToBox(t.x, t.z, box);
            assert.ok(d >= r + TREE_GAP - EPS, `tree ${i} overlaps ${what}`);
          }
          const disc: Rect = { minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r };
          layout.streets.forEach((s, j) => {
            assert.ok(rectGap(disc, edges(s)) >= TREE_GAP - EPS, `tree ${i} is on street ${j}`);
          });
          for (const { outer, inner } of kerbs) {
            if (rectGap(disc, outer) >= 0) continue;
            assert.ok(insideRect(t, inner, r), `tree ${i} is on a sidewalk`);
          }
          layout.walks.forEach((w, j) => {
            assert.ok(rectGap(disc, edges(w)) >= 0, `tree ${i} is on walk ${j}`);
          });
          for (let j = i + 1; j < trees.length; j++) {
            const u = trees[j];
            const d = Math.hypot(t.x - u.x, t.z - u.z);
            assert.ok(d >= r + TREE_RADIUS * u.size + TREE_GAP - EPS, `trees ${i}, ${j} overlap`);
          }
        });
      });

      // Trees and the road out stand in the fields too; the bounds frame the town itself.
      test("everything built lies inside the bounds", () => {
        const b = layout.bounds;
        for (const r of [...blockRects, ...streets]) {
          assert.ok(insideRect({ x: r.minX, z: r.minZ }, b), "a block or street is out of bounds");
          assert.ok(insideRect({ x: r.maxX, z: r.maxZ }, b), "a block or street is out of bounds");
        }
        for (const { what, box } of built) {
          for (const c of corners(box)) assert.ok(insideRect(c, b), `${what} is out of bounds`);
        }
      });

      test("the town's height clears its tallest roof, tower and tree", () => {
        const tops = [
          ...layout.homes.map((h) => HOME_TOP * h.heightScale),
          ...layout.buildings.map((b) => b.height),
          ...layout.buildings.flatMap((b) => (b.tower ? [b.tower.height] : [])),
          layout.screen.top,
          ...layout.trees.map((t) => TREE_HEIGHT * t.size),
        ];
        assert.ok(layout.height >= Math.max(...tops));
      });
    });
  }
});

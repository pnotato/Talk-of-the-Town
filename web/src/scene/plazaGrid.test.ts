/// <reference types="node" />
// Run: node --test web/src/scene/plazaGrid.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCity } from "./layoutCity.ts";
import {
  distanceToOutline,
  insidePolygon,
  type Point,
  polygonArea,
  SPOT_SPACING,
} from "./mapLayout.ts";
import {
  GROUT,
  hexTile,
  insetPolygon,
  TILE_RADIUS,
  tileOutlines,
  tilePositions,
} from "./plazaGrid.ts";

const EPS = 1e-9;
const { spots, outline } = layoutCity(53, 5).gathering;
const tiles = tileOutlines(spots, outline);
const HEX_AREA = polygonArea(hexTile({ x: 0, z: 0 }));

test("neighbouring tiles meet along parallel sides, a grout joint apart", () => {
  let pairs = 0;
  for (let i = 0; i < spots.length; i++) {
    for (let j = 0; j < spots.length; j++) {
      const [a, b] = [spots[i], spots[j]];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (i === j || d > SPOT_SPACING + EPS) continue;
      pairs++;
      // Along the line between them, A's tile ends and B's begins with exactly the grout between.
      const along = (p: Point) => ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / d;
      const aEnds = Math.max(...hexTile(a).map(along));
      const bBegins = Math.min(...hexTile(b).map(along));
      assert.ok(Math.abs(bBegins - aEnds - GROUT) < 1e-6, `spots ${i} and ${j}`);
      // Two corners of each sit on that side, so the sides are parallel.
      assert.equal(hexTile(a).filter((p) => Math.abs(along(p) - aEnds) < 1e-6).length, 2);
    }
  }
  assert.ok(pairs > 2 * spots.length, `${pairs} neighbours`);
});

test("insetPolygon moves every edge of the bow-tie in by the same distance", () => {
  const d = 0.5;
  const inset = insetPolygon(outline, d);
  assert.equal(inset.length, outline.length);
  const n = outline.length;
  // Distance from p to the line through a and b.
  const toLine = (p: Point, a: Point, b: Point) =>
    Math.abs((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) /
    Math.hypot(b.x - a.x, b.z - a.z);
  inset.forEach((p, i) => {
    assert.ok(insidePolygon(p, outline));
    // At least d from the outline: exactly d at a corner, a little more in a notch's tip.
    assert.ok(distanceToOutline(p, outline) >= d - 1e-9);
    assert.ok(Math.abs(toLine(p, outline[(i + n - 1) % n], outline[i]) - d) < 1e-9);
    assert.ok(Math.abs(toLine(p, outline[i], outline[(i + 1) % n]) - d) < 1e-9);
  });
  // Either way round.
  assert.deepEqual(insetPolygon([...outline].reverse(), d).reverse(), inset);
});

test("tiles stay on the paving, half a joint in from its edge", () => {
  assert.equal(tiles.length, spots.length);
  for (const tile of tiles) {
    for (const p of tile) {
      assert.ok(insidePolygon(p, outline), "a tile runs off the paving");
      assert.ok(distanceToOutline(p, outline) >= GROUT / 2 - 1e-6, "a tile reaches the edge");
    }
  }
});

test("tiles clear of the edge are whole hexes; tiles at the edge are cut, not lost", () => {
  let cut = 0;
  tiles.forEach((tile, i) => {
    const area = polygonArea(tile);
    if (distanceToOutline(spots[i], outline) >= TILE_RADIUS + GROUT / 2) {
      assert.ok(Math.abs(area - HEX_AREA) < 1e-9, `tile ${i} is not whole`);
    } else {
      if (area < HEX_AREA - 1e-9) cut++;
      assert.ok(area > 0.6 * HEX_AREA, `tile ${i} keeps ${(area / HEX_AREA).toFixed(2)}`);
    }
  });
  assert.ok(cut > 0, "no tile met the edge");
});

test("the triangles face up and cover every tile exactly", () => {
  const positions = tilePositions(tiles, 0.16);
  let area = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = positions.subarray(i, i + 9);
    for (const y of [y0, y1, y2]) assert.ok(Math.abs(y - 0.16) < 1e-6);
    // y of (v1 - v0) x (v2 - v0): positive when the triangle is front-facing from above.
    const up = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
    assert.ok(up > 0, `triangle ${i / 9} faces down`);
    area += up / 2;
  }
  const expected = tiles.reduce((sum, tile) => sum + polygonArea(tile), 0);
  assert.ok(Math.abs(area - expected) < 1e-3 * expected, `${area} of ${expected}`);
});

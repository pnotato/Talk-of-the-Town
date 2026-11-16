/// <reference types="node" />
// Run: node --test web/src/scene/blobShapes.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Box3, Mesh, Raycaster, Vector3 } from "three";
import { ADULT_HEIGHT, BLOB_GEOMETRY, SHAPES, type Shape } from "./blobGeometry.ts";
import { type AgeGroup, ageGroup, blobScale } from "./blobSize.ts";

const EPS = 1e-6;

describe("ageGroup", () => {
  test("follows docs/BLOBS.md: child 0–17, adult 18–64, elder 65+", () => {
    const cases: [age: number, group: AgeGroup][] = [
      [0, "child"],
      [17, "child"],
      [18, "adult"],
      [64, "adult"],
      [65, "elder"],
      [94, "elder"],
    ];
    for (const [age, group] of cases) assert.equal(ageGroup(age), group, `age ${age}`);
  });
});

describe("blobScale", () => {
  const [child, adult, elder] = [8, 35, 75].map(blobScale);
  const stockiness = ([width, height]: readonly number[]) => width / height;

  test("grows with age in height and in width", () => {
    assert.ok(child[1] < adult[1] && adult[1] < elder[1], "height");
    assert.ok(child[0] < adult[0] && adult[0] < elder[0], "width");
  });

  test("makes elders stockier, while children and adults keep the adult proportions", () => {
    assert.equal(stockiness(child), 1);
    assert.equal(stockiness(adult), 1);
    assert.ok(stockiness(elder) >= 1.1, `elder width/height ${stockiness(elder).toFixed(2)}`);
  });

  test("keeps every footprint round or square: width equals depth", () => {
    for (const scale of [child, adult, elder]) assert.equal(scale[0], scale[2]);
  });
});

/**
 * Front silhouette area, by casting a grid of rays along -z through the bounding box. A 0.04 step
 * keeps every shape within about 1% of a fine grid's result, at a fraction of the cost.
 */
function silhouetteArea(shape: Shape, step = 0.04): number {
  const mesh = new Mesh(BLOB_GEOMETRY[shape]);
  const { min, max } = new Box3().setFromObject(mesh);
  const raycaster = new Raycaster();
  const origin = new Vector3();
  const back = new Vector3(0, 0, -1);
  let hits = 0;
  for (let x = min.x + step / 2; x < max.x; x += step) {
    for (let y = min.y + step / 2; y < max.y; y += step) {
      raycaster.set(origin.set(x, y, max.z + 1), back);
      if (raycaster.intersectObject(mesh).length > 0) hits++;
    }
  }
  return hits * step * step;
}

describe("BLOB_GEOMETRY", () => {
  for (const shape of SHAPES) {
    describe(shape, () => {
      const geometry = BLOB_GEOMETRY[shape];
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      geometry.computeBoundingBox(); // fresh from the positions, not trusting the cached box
      const { min, max } = geometry.boundingBox!;

      test("stands on y = 0, centred on the y axis", () => {
        assert.ok(Math.abs(min.y) < EPS, `lowest point y = ${min.y}`);
        assert.ok(Math.abs(min.x + max.x) < EPS, "centred in x");
        assert.ok(Math.abs(min.z + max.z) < EPS, "centred in z");
      });

      test("is its adult height, which is about 1 unit", () => {
        assert.ok(Math.abs(max.y - min.y - ADULT_HEIGHT[shape]) < EPS, `height ${max.y - min.y}`);
        assert.ok(
          ADULT_HEIGHT[shape] >= 0.8 && ADULT_HEIGHT[shape] <= 1.2,
          `adult height ${ADULT_HEIGHT[shape]}`,
        );
      });

      test("has unit normals that all point outwards", () => {
        // Every shape is star-shaped about the axis point at half height: seen from there, no part
        // of the surface hides another. So an outward normal never points back towards it.
        const centre = new Vector3(0, (min.y + max.y) / 2, 0);
        const p = new Vector3();
        const n = new Vector3();
        for (let i = 0; i < position.count; i++) {
          n.fromBufferAttribute(normal, i);
          assert.ok(Math.abs(n.length() - 1) < 1e-4, `normal ${i} has length ${n.length()}`);
          p.fromBufferAttribute(position, i).sub(centre);
          assert.ok(n.dot(p) > -1e-3, `normal ${i} points inwards`);
        }
      });
    });
  }

  test("gives every shape a similar visual mass: front silhouettes within 10% of the mean", () => {
    const areas = SHAPES.map((shape) => silhouetteArea(shape));
    const mean = areas.reduce((sum, a) => sum + a, 0) / areas.length;
    SHAPES.forEach((shape, i) => {
      const off = areas[i] / mean - 1;
      assert.ok(Math.abs(off) <= 0.1, `${shape} is ${(off * 100).toFixed(1)}% off the mean`);
    });
  });
});

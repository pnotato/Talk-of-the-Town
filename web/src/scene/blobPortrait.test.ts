/// <reference types="node" />
// Run: node --test web/src/scene/blobPortrait.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { ADULT_HEIGHT, BLOB_GEOMETRY, SHAPES } from "./blobGeometry.ts";
import { PORTRAIT_FOV, portraitFraming } from "./blobPortrait.ts";
import { blobScale } from "./blobSize.ts";

const ASPECTS = [0.6, 1, 1.6];

/** Where a point lands on screen, -1..1 each way, for the portrait camera. */
function project(shape: (typeof SHAPES)[number], aspect: number, point: Vector3) {
  const { position, target } = portraitFraming(shape, aspect);
  const camera = new PerspectiveCamera(PORTRAIT_FOV, aspect, 0.1, 50);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  return point.clone().project(camera);
}

/** The corners of the box around a blob of this age. */
function corners(shape: (typeof SHAPES)[number], age: number) {
  const { max } = BLOB_GEOMETRY[shape].boundingBox!;
  const [sx, sy, sz] = blobScale(age);
  const height = ADULT_HEIGHT[shape] * sy;
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new Vector3(
        i & 1 ? max.x * sx : -max.x * sx,
        i & 2 ? height : 0,
        i & 4 ? max.z * sz : -max.z * sz,
      ),
  );
}

describe("portraitFraming", () => {
  test("keeps every shape's biggest size inside the frame, in tall, square and wide canvases", () => {
    for (const shape of SHAPES) {
      for (const aspect of ASPECTS) {
        for (const corner of corners(shape, 75)) {
          const { x, y } = project(shape, aspect, corner);
          assert.ok(Math.abs(x) < 1 && Math.abs(y) < 1, `${shape} @ ${aspect}: ${x}, ${y}`);
        }
      }
    }
  });

  test("fills the frame rather than leaving the blob lost in it", () => {
    for (const shape of SHAPES) {
      const ys = corners(shape, 75).map((c) => project(shape, 1, c).y);
      assert.ok(Math.max(...ys) - Math.min(...ys) > 1.4, shape);
    }
  });

  test("looks down on the blob from the front, aimed at its face height", () => {
    for (const shape of SHAPES) {
      const { position, target } = portraitFraming(shape, 1);
      assert.equal(position[0], 0);
      assert.ok(position[2] > 0, "in front, where the face is");
      assert.ok(position[1] > target[1], "raised");
      assert.ok(target[1] > 0.4 * ADULT_HEIGHT[shape]);
    }
  });

  test("frames the same for every age, so a child looks smaller than an adult", () => {
    // Framing takes no age: a child's top lands lower on screen than an adult's.
    const top = (age: number) => {
      const height = ADULT_HEIGHT.circle * blobScale(age)[1];
      return project("circle", 1, new Vector3(0, height, 0)).y;
    };
    assert.ok(top(8) < top(35) && top(35) < top(75));
  });

  test("survives a canvas that has not been measured yet", () => {
    for (const aspect of [0, NaN, Infinity]) {
      const { position } = portraitFraming("square", aspect);
      assert.ok(position.every(Number.isFinite));
    }
  });
});

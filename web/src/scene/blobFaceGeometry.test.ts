/// <reference types="node" />
// Run: node --test web/src/scene/blobFaceGeometry.test.ts (Node strips the types natively).
// Importing blobFaceGeometry.ts builds every face, and that throws if any feature misses its body.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FACE_GEOMETRY, facePlacement } from "./blobFaceGeometry.ts";
import { SHAPES } from "./blobGeometry.ts";

for (const shape of SHAPES) {
  describe(`${shape} face`, () => {
    const { eyes, smile } = facePlacement(shape);
    const features = [...eyes, ...smile];

    test("has two eyes and a smile, all on the front of the body", () => {
      assert.equal(eyes.length, 2);
      assert.ok(smile.length >= 3);
      for (const { point } of features) assert.ok(point.z > 0, `point at z = ${point.z}`);
    });

    test("looks forward: every feature sits where the surface faces within 60° of +z", () => {
      for (const { normal } of features) {
        assert.ok(normal.z > 0.5, `surface normal z = ${normal.z.toFixed(2)}`);
      }
    });

    test("has level eyes either side of the centre line, and the smile below them", () => {
      const [left, right] = eyes.map(({ point }) => point);
      assert.ok(Math.abs(left.y - right.y) < 1e-6, "eyes level");
      assert.ok(left.x < 0 && right.x > 0, "eyes either side of x = 0");
      for (const { point } of smile) assert.ok(point.y < left.y, "smile below the eyes");
    });

    test("builds a face geometry in front of the body", () => {
      const geometry = FACE_GEOMETRY[shape];
      assert.ok(geometry.getAttribute("position").count > 0);
      geometry.computeBoundingBox();
      const { z } = geometry.boundingBox!.min;
      assert.ok(z > 0, `face reaches back to z = ${z}`);
    });
  });
}

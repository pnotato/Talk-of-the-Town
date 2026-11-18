/// <reference types="node" />
// Run: node --test web/src/scene/blobSelection.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SHAPES } from "./blobGeometry.ts";
import { footprintRadius, ringGeometries } from "./blobSelection.ts";

const AGES = { child: 8, adult: 35, elder: 75 };

const radii = (geometry: { boundingBox: { max: { x: number } } | null }) =>
  geometry.boundingBox!.max.x;

describe("footprintRadius", () => {
  test("grows with age for every shape", () => {
    for (const shape of SHAPES) {
      const [child, adult, elder] = [AGES.child, AGES.adult, AGES.elder].map((age) =>
        footprintRadius(shape, age),
      );
      assert.ok(child < adult && adult < elder, shape);
    }
  });
});

describe("ringGeometries", () => {
  test("circles the blob's footprint with clear ground between, at every size", () => {
    for (const shape of SHAPES) {
      for (const age of Object.values(AGES)) {
        const { ring, outline } = ringGeometries(shape, age);
        ring.computeBoundingBox();
        outline.computeBoundingBox();
        const footprint = footprintRadius(shape, age);
        // The outer edge of the ring is its widest point.
        assert.ok(radii(ring) > footprint, `${shape} ${age} ring clears the blob`);
        assert.ok(radii(outline) > radii(ring), `${shape} ${age} outline surrounds the ring`);
      }
    }
  });

  test("lies flat on the ground", () => {
    const { ring, outline } = ringGeometries("star", 35);
    for (const geometry of [ring, outline]) {
      geometry.computeBoundingBox();
      assert.ok(Math.abs(geometry.boundingBox!.max.y) < 1e-9);
      assert.ok(Math.abs(geometry.boundingBox!.min.y) < 1e-9);
    }
  });

  test("is built once per shape and age group, and shared", () => {
    assert.equal(ringGeometries("tear", 20), ringGeometries("tear", 60));
    assert.notEqual(ringGeometries("tear", 20), ringGeometries("tear", 8));
    assert.notEqual(ringGeometries("tear", 20), ringGeometries("star", 20));
  });
});

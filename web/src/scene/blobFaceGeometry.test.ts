/// <reference types="node" />
// Run: node --test web/src/scene/blobFaceGeometry.test.ts (Node strips the types natively).
// Importing blobFaceGeometry.ts builds every face part, and that throws if any point misses a body.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type BufferGeometry, Vector3 } from "three";
import { BROWS, EYES, FACE_PARTS, MOUTHS, onBody, PHONE_SPOT } from "./blobFaceGeometry.ts";
import { SHAPES } from "./blobGeometry.ts";
import { MOOD_FACE, MOODS } from "./blobMood.ts";

const BROW_STYLES = ["worried", "angry"] as const;
const MOUTH_STYLES = ["smile", "frown", "line", "o"] as const;

function centre(geometry: BufferGeometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getCenter(new Vector3());
}

const allFacePoints = [
  ...FACE_PARTS.eyeDots,
  ...FACE_PARTS.shutEyes.flatMap((s) => s.points),
  ...BROW_STYLES.flatMap((b) => FACE_PARTS.brows[b].flatMap((s) => s.points)),
  ...MOUTH_STYLES.flatMap((m) => [...FACE_PARTS.mouths[m].points, FACE_PARTS.mouths[m].pivot]),
  FACE_PARTS.phone,
];

describe("face parts in face space", () => {
  test("worried brows raise their inner ends and angry brows lower them", () => {
    for (const style of BROW_STYLES) {
      for (const { points } of FACE_PARTS.brows[style]) {
        const [a, b] = [points[0], points[points.length - 1]];
        const [inner, outer] = Math.abs(a[0]) < Math.abs(b[0]) ? [a, b] : [b, a];
        if (style === "worried") assert.ok(inner[1] > outer[1], "worried: inner end higher");
        else assert.ok(inner[1] < outer[1], "angry: inner end lower");
      }
    }
  });
});

for (const shape of SHAPES) {
  describe(`${shape} face`, () => {
    test("lands every point of every part on the front of the body, where it faces forward", () => {
      for (const p of allFacePoints) {
        const { point, normal } = onBody(shape, p);
        assert.ok(point.z > 0, `(${p}) lands at z = ${point.z}`);
        assert.ok(normal.z > 0.5, `(${p}) lands where the normal z is ${normal.z.toFixed(2)}`);
      }
    });

    test("stacks brows above the eyes and every mouth below them, centred left to right", () => {
      const eyes = centre(EYES[shape].open);
      assert.ok(
        Math.abs(centre(EYES[shape].shut).y - eyes.y) < 0.03,
        "shut eyes where open eyes are",
      );
      for (const style of BROW_STYLES) {
        const brows = centre(BROWS[shape][style]);
        assert.ok(brows.y > eyes.y, `${style} brows above the eyes`);
        assert.ok(Math.abs(brows.x) < 1e-6, `${style} brows centred`);
      }
      for (const style of MOUTH_STYLES) {
        const { position } = MOUTHS[shape][style];
        assert.ok(position.y < eyes.y, `${style} mouth below the eyes`);
        assert.ok(Math.abs(position.x) < 1e-6, `${style} mouth centred`);
      }
    });

    test("builds every mouth around a pivot on the surface, so it opens in place", () => {
      for (const style of MOUTH_STYLES) {
        const { geometry, position, quaternion } = MOUTHS[shape][style];
        const middle = centre(geometry);
        assert.ok(Math.abs(middle.x) < 0.01 && Math.abs(middle.y) < 0.01, `${style} centred`);
        assert.ok(Math.abs(middle.z) < 0.02, `${style} sits on the surface`);
        assert.ok(position.z > 0, `${style} pivot on the front`);
        const out = new Vector3(0, 0, 1).applyQuaternion(quaternion);
        assert.ok(out.z > 0.5, `${style} pivot faces forward`);
      }
    });

    test("holds the phone in front of the body and below the mouth", () => {
      const surface = onBody(shape, FACE_PARTS.phone).point;
      assert.ok(PHONE_SPOT[shape].z > surface.z, "in front of the body");
      for (const style of MOUTH_STYLES)
        assert.ok(PHONE_SPOT[shape].y < MOUTHS[shape][style].position.y);
    });

    test("can wear every mood", () => {
      for (const mood of MOODS) {
        const face = MOOD_FACE[mood];
        const parts = [EYES[shape][face.eyes], MOUTHS[shape][face.mouth].geometry];
        if (face.brows) parts.push(BROWS[shape][face.brows]);
        for (const part of parts) assert.ok(part.getAttribute("position").count > 0, mood);
      }
    });
  });
}

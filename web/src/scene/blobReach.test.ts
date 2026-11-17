/// <reference types="node" />
// Run: node --test web/src/scene/blobReach.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Euler, Matrix4 } from "three";
import { BASE_EXTENT, BLOB_GEOMETRY, SHAPES, type Shape } from "./blobGeometry.ts";
import { MOODS } from "./blobMood.ts";
import { animate, createAnimation, createMotion, POSES } from "./blobMotion.ts";
import { blobScale } from "./blobSize.ts";
import { BLOB_REACH } from "./mapLayout.ts";

// Long enough to cover every idle loop's slowest swing (the sleepy sway is about 10.5 s).
const SECONDS = 13;
const STEP = 0.02;

// Each shape's distinct vertices, as flat x, y, z triples.
function corners(shape: Shape): Float64Array {
  const position = BLOB_GEOMETRY[shape].getAttribute("position");
  const seen = new Set<string>();
  const points: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(x, y, z);
  }
  return new Float64Array(points);
}

// Furthest any vertex of an adult-sized body gets from its spot, across the ground, over the
// loop. The motion is applied as Blob.tsx applies it: the body turns and stretches about its feet.
function bodyReach(shape: Shape, setUp: (a: ReturnType<typeof createAnimation>) => void) {
  const points = corners(shape);
  const animation = createAnimation("flat");
  setUp(animation);
  const motion = createMotion();
  const rotation = new Matrix4();
  const euler = new Euler();
  let furthest = 0;
  for (let t = 0; t < SECONDS; t += STEP) {
    const m = animate(animation, t, STEP, 0, BASE_EXTENT[shape], motion);
    const e = rotation.makeRotationFromEuler(euler.set(m.rx, m.ry, m.rz)).elements;
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i] * m.sx;
      const y = points[i + 1] * m.sy;
      const z = points[i + 2] * m.sx;
      const wx = e[0] * x + e[4] * y + e[8] * z;
      const wz = e[2] * x + e[6] * y + e[10] * z;
      furthest = Math.max(furthest, wx * wx + wz * wz);
    }
  }
  return Math.sqrt(furthest);
}

test("no blob reaches further than BLOB_REACH while it idles or holds a pose", () => {
  // Age scales the whole body, turned or not, by the same amount across the ground, so the
  // widest age sets the reach.
  const widths = [8, 35, 75].map((age) => {
    const [x, , z] = blobScale(age);
    assert.equal(x, z);
    return x;
  });
  const widest = Math.max(...widths);
  let furthest = 0;
  for (const shape of SHAPES) {
    const loops = [
      ...MOODS.map((mood) => ({
        name: mood,
        setUp: (a: ReturnType<typeof createAnimation>) => {
          a.mood = mood;
          a.idle = true;
        },
      })),
      ...POSES.map((pose) => ({
        name: pose,
        setUp: (a: ReturnType<typeof createAnimation>) => {
          a.pose = pose;
        },
      })),
    ];
    for (const { name, setUp } of loops) {
      const r = widest * bodyReach(shape, setUp);
      assert.ok(r <= BLOB_REACH, `${shape}, ${name}: reaches ${r.toFixed(3)}`);
      furthest = Math.max(furthest, r);
    }
  }
  // Not padded so far that the plaza loses standing spots for nothing.
  assert.ok(furthest > BLOB_REACH - 0.1, `furthest reach ${furthest.toFixed(3)}`);
});

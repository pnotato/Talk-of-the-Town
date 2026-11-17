/// <reference types="node" />
// Run: node --test web/src/scene/blobMotion.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { BASE_EXTENT, SHAPES } from "./blobGeometry.ts";
import { MOODS } from "./blobMood.ts";
import {
  animate,
  type Base,
  type BlobAnimation,
  createAnimation,
  createMotion,
  type Motion,
  mouthOpen,
  phaseFor,
  POSES,
  squash,
} from "./blobMotion.ts";

const FRAME = 1 / 60;

/** Plays `seconds` of animation and calls `check` with every frame's motion. */
function play(
  anim: BlobAnimation,
  base: Base,
  speed: number,
  seconds: number,
  check: (m: Motion) => void,
) {
  const out = createMotion();
  for (let t = 0; t < seconds; t += FRAME) check(animate(anim, t, FRAME, speed, base, out));
}

const matrix = new Matrix4();
const rotation = new Quaternion();
const corner = new Vector3();

/** The lowest point of a flat base after the motion moves the body about its feet. */
function lowestBasePoint({ x, z }: Base, m: Motion) {
  rotation.setFromEuler(new Euler(m.rx, m.ry, m.rz));
  matrix.compose(new Vector3(0, m.y, 0), rotation, new Vector3(m.sx, m.sy, m.sx));
  let lowest = Infinity;
  for (const [cx, cz] of [
    [x, z],
    [-x, z],
    [x, -z],
    [-x, -z],
  ]) {
    lowest = Math.min(lowest, corner.set(cx, 0, cz).applyMatrix4(matrix).y);
  }
  return lowest;
}

describe("squash", () => {
  test("keeps the volume: width × height × depth stays 1", () => {
    for (const sy of [0.7, 0.88, 1, 1.15, 1.5]) {
      const m = squash(createMotion(), sy);
      assert.ok(Math.abs(m.sx * m.sy * m.sx - 1) < 1e-12, `sy ${sy}`);
    }
  });
});

describe("animate", () => {
  test("gives the rest pose under reduced motion, whatever the blob is doing", () => {
    for (const mood of MOODS) {
      for (const pose of POSES) {
        const anim = Object.assign(createAnimation(mood), {
          pose,
          idle: true,
          talking: true,
          reduceMotion: true,
        });
        play(anim, BASE_EXTENT.square, 2, 1, (m) =>
          assert.deepEqual(m, { y: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1 }),
        );
      }
    }
  });

  test("keeps the feet planted: the base never dips below the ground", () => {
    for (const shape of SHAPES) {
      const base = BASE_EXTENT[shape];
      for (const mood of MOODS) {
        for (const pose of POSES) {
          for (const speed of [0, 2]) {
            const anim = Object.assign(createAnimation(mood), { pose, idle: true });
            play(anim, base, speed, 4, (m) => {
              const low = lowestBasePoint(base, m);
              assert.ok(low > -1e-9, `${shape} ${mood} ${pose} at speed ${speed}: base at ${low}`);
            });
          }
        }
      }
    }
  });

  test("keeps every mood's idle loop small: no wild spins, stretches or leaps", () => {
    for (const mood of MOODS) {
      const anim = Object.assign(createAnimation(mood), { idle: true });
      play(anim, BASE_EXTENT.circle, 0, 10, (m) => {
        for (const angle of [m.rx, m.ry, m.rz]) assert.ok(Math.abs(angle) <= 0.35, mood);
        for (const scale of [m.sx, m.sy]) assert.ok(scale >= 0.85 && scale <= 1.25, mood);
        assert.ok(m.y >= 0 && m.y <= 0.45, mood);
      });
    }
  });

  test("squashes and stretches a walking blob while keeping its volume", () => {
    const anim = createAnimation("flat");
    let [shortest, tallest] = [Infinity, -Infinity];
    play(anim, BASE_EXTENT.circle, 2, 4, (m) => {
      assert.ok(Math.abs(m.sx * m.sy * m.sx - 1) < 1e-9, "volume kept");
      [shortest, tallest] = [Math.min(shortest, m.sy), Math.max(tallest, m.sy)];
    });
    assert.ok(shortest < 0.95 && tallest > 1.1, `sy from ${shortest} to ${tallest}`);
  });

  test("plays the idle loop only while the blob isn't posing", () => {
    const anim = Object.assign(createAnimation("smile"), { idle: true, pose: "phone" as const });
    play(anim, BASE_EXTENT.circle, 0, 4, (m) => assert.ok(m.y < 0.01, "no happy hop on the phone"));
  });
});

describe("mouthOpen", () => {
  test("flaps between shut and open only while talking, and stays shut with reduced motion", () => {
    const anim = createAnimation("smile");
    let widest = 0;
    for (let t = 0; t < 1; t += FRAME) {
      anim.talking = false;
      assert.equal(mouthOpen(anim, t), 0);
      anim.talking = true;
      const open = mouthOpen(anim, t);
      assert.ok(open >= 0 && open <= 1);
      widest = Math.max(widest, open);
      anim.reduceMotion = true;
      assert.equal(mouthOpen(anim, t), 0);
      anim.reduceMotion = false;
    }
    assert.ok(widest > 0.9);
  });
});

describe("phaseFor", () => {
  test("is deterministic and spreads neighbouring ids at least a second apart", () => {
    for (let id = 0; id < 100; id++) {
      assert.equal(phaseFor(id), phaseFor(id));
      assert.ok(phaseFor(id) >= 0 && phaseFor(id) < 10);
      const gap = Math.abs(phaseFor(id + 1) - phaseFor(id));
      assert.ok(Math.min(gap, 10 - gap) >= 1, `ids ${id} and ${id + 1}`);
    }
  });
});

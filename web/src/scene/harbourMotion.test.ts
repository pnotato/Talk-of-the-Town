/// <reference types="node" />
// Run: node --test web/src/scene/harbourMotion.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createFireworkQueue,
  FIREWORK,
  FIREWORK_LIFE,
  type Heading,
  lastLaunch,
  launchFirework,
  MAX_FIREWORKS,
  restartBoost,
  sailAt,
  type Spark,
  sparkAt,
  toyBoost,
  WAVE_REACH,
  WAVES,
  waveGlsl,
  waveHeight,
} from "./harbourMotion.ts";

const EPS = 1e-9;

describe("waveHeight", () => {
  test("stays within the waves' reach, and moves", () => {
    let lowest = Infinity;
    let highest = -Infinity;
    for (let x = -60; x <= 60; x += 3.7) {
      for (let z = -60; z <= 10; z += 2.9) {
        for (const t of [0, 0.4, 2.5, 11]) {
          const y = waveHeight(x, z, t);
          lowest = Math.min(lowest, y);
          highest = Math.max(highest, y);
        }
      }
    }
    assert.ok(highest <= WAVE_REACH + EPS && lowest >= -WAVE_REACH - EPS);
    // Real swell, not a flat sea: most of the reach is used somewhere.
    assert.ok(highest > WAVE_REACH * 0.6 && lowest < -WAVE_REACH * 0.6, `${lowest}..${highest}`);
    assert.notEqual(waveHeight(3, -7, 0), waveHeight(3, -7, 0.5));
  });

  test("the shader's GLSL is written from the same waves", () => {
    const glsl = waveGlsl();
    assert.match(glsl, /^float waveHeight\(vec2 p, float t\) \{/);
    assert.equal(glsl.match(/sin\(/g)?.length, WAVES.length);
    for (const w of WAVES) {
      assert.ok(glsl.includes(`${w.amplitude} * sin(`), `amplitude ${w.amplitude}`);
      assert.ok(glsl.includes(`${w.speed} * t)`), `speed ${w.speed}`);
    }
    // Every number is a GLSL float literal, never a bare int.
    assert.doesNotMatch(glsl, /[^.\d]\d+[,)]/);
  });
});

describe("toyBoost", () => {
  test("is 0 before the click and once it's over, and 1 in the middle", () => {
    assert.equal(toyBoost(-0.1, 6), 0);
    assert.equal(toyBoost(Number.NaN, 6), 0);
    assert.equal(toyBoost(0, 6), 0);
    assert.equal(toyBoost(6, 6), 0);
    assert.equal(toyBoost(60, 6), 0);
    assert.equal(toyBoost(2, 6), 1);
  });

  test("rises and settles without a jump", () => {
    let last = 0;
    for (let t = 0; t <= 6; t += 0.01) {
      const b = toyBoost(t, 6);
      assert.ok(b >= 0 && b <= 1);
      assert.ok(Math.abs(b - last) < 0.05, `jump at ${t}`);
      last = b;
    }
  });
});

describe("sailAt", () => {
  const lap = { x: -46, z: -30, heading: 0.6, loop: { x: -40.9, z: -44.1, radius: 15 } };
  // Make the circle pass exactly through the mooring.
  lap.loop.radius = Math.hypot(lap.x - lap.loop.x, lap.z - lap.loop.z);
  const at: Heading = { x: 0, z: 0, heading: 0 };

  test("leaves from its mooring and comes back to it, bow as it was", () => {
    for (const u of [0, 1]) {
      sailAt(lap, u, at);
      assert.ok(Math.abs(at.x - lap.x) < 1e-6 && Math.abs(at.z - lap.z) < 1e-6, `u=${u}`);
      assert.ok(Math.abs(Math.sin(at.heading - lap.heading)) < 1e-6);
    }
  });

  test("sails round the circle, steering the way it moves", () => {
    let last = sailAt(lap, 0, { x: 0, z: 0, heading: 0 });
    for (let u = 0.01; u <= 0.99; u += 0.01) {
      sailAt(lap, u, at);
      const off = Math.hypot(at.x - lap.loop.x, at.z - lap.loop.z) - lap.loop.radius;
      assert.ok(Math.abs(off) < 1e-6);
      if (u > 0.15 && u < 0.85) {
        const moved = Math.atan2(at.x - last.x, at.z - last.z);
        assert.ok(Math.cos(moved - at.heading) > 0.95, `bow off course at ${u.toFixed(2)}`);
      }
      last = { ...at };
    }
    // Halfway round it is across the circle from its mooring.
    sailAt(lap, 0.5, at);
    assert.ok(Math.abs(Math.hypot(at.x - lap.x, at.z - lap.z) - 2 * lap.loop.radius) < 1e-6);
  });
});

describe("sparkAt", () => {
  const spark: Spark = { x: 0, y: 0, z: 0, glow: 0 };

  test("before the burst only the rocket and its trail glow, climbing to the burst's height", () => {
    let last = -1;
    for (let age = 0; age < FIREWORK.rise; age += 0.05) {
      assert.equal(sparkAt(FIREWORK.trail, age, 16, 0, spark).glow, 0);
      sparkAt(0, age, 16, 0, spark);
      assert.ok(spark.glow > 0 && spark.y > last && spark.y <= 16);
      last = spark.y;
      // Each trail spark is below the rocket and dimmer.
      const rocket = { ...spark };
      sparkAt(2, age, 16, 0, spark);
      if (spark.glow > 0) assert.ok(spark.y < rocket.y && spark.glow < rocket.glow);
    }
  });

  test("bursts into a sphere round the top, then droops and fades out", () => {
    const n = FIREWORK.sparks;
    const droop = 0.5 * FIREWORK.gravity * 0.6 * 0.6;
    let up = 0;
    for (let i = 0; i < n; i++) {
      sparkAt(i, FIREWORK.rise + 0.6, 16, 1.3, spark);
      const r = Math.hypot(spark.x, spark.y - 16 + droop, spark.z);
      const reach = (FIREWORK.speed * (1 - Math.exp(-FIREWORK.drag * 0.6))) / FIREWORK.drag;
      assert.ok(Math.abs(r - reach) < 1e-6, `spark ${i} off the sphere`);
      if (spark.y + droop > 16) up++;
      assert.ok(spark.glow > 0);
    }
    assert.ok(Math.abs(up - n / 2) <= 2, `${up} of ${n} sparks fly upwards`);
    for (const age of [FIREWORK_LIFE, FIREWORK_LIFE + 1, -1]) {
      assert.equal(sparkAt(3, age, 16, 0, spark).glow, 0);
    }
    assert.ok(sparkAt(3, FIREWORK_LIFE - 0.05, 16, 0, spark).glow < 0.01);
  });
});

describe("restartBoost", () => {
  test("a toy clicked again carries on from where it is, and rises again", () => {
    for (const since of [0.1, 0.3, 2, 4.5, 5.5]) {
      const now = toyBoost(since, 6);
      const restarted = restartBoost(since, 6);
      assert.ok(Math.abs(toyBoost(restarted, 6) - now) < 1e-9, `at ${since}`);
      assert.ok(restarted <= 0.5 + EPS);
    }
    assert.equal(restartBoost(-1, 6), 0);
    assert.equal(restartBoost(9, 6), 0);
  });
});

describe("the firework queue", () => {
  test("launches into the next slot, and the oldest makes way after MAX_FIREWORKS", () => {
    const queue = createFireworkQueue();
    assert.equal(lastLaunch(queue), -Infinity);
    for (let n = 0; n < MAX_FIREWORKS + 3; n++) launchFirework(queue, n, -n, 100 + n, 6);
    assert.equal(lastLaunch(queue), 100 + MAX_FIREWORKS + 2);
    // Slot 0 was reused by the MAX_FIREWORKS-th launch.
    assert.equal(queue.xs[0], MAX_FIREWORKS);
    for (let s = 0; s < MAX_FIREWORKS; s++) {
      assert.ok(queue.heights[s] >= 13 && queue.heights[s] <= 20);
      assert.ok(queue.colours[s] < 6);
    }
  });
});

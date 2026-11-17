/// <reference types="node" />
// Run: node --test web/src/scene/scatterCrowd.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SHAPES } from "./blobGeometry.ts";
import { MOODS } from "./blobMood.ts";
import { ageGroup } from "./blobSize.ts";
import { layoutCity } from "./layoutCity.ts";
import { BLOB_REACH, distanceToObstacle, insidePolygon, type Point } from "./mapLayout.ts";
import {
  AGE_BANDS,
  CROWD_SIZE,
  DEFAULT_CROWD_SEED,
  FACING_SPREAD,
  scatterCrowd,
} from "./scatterCrowd.ts";

const city = layoutCity(53, 5);
const cells = city.gathering.spots;
const crowd = scatterCrowd(DEFAULT_CROWD_SEED, cells, CROWD_SIZE);
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe("the plaza's grid", () => {
  test("every city has at least 100 cells, comfortably more than the crowd", () => {
    for (const homes of [0, 1, 10, 53, 100, 200]) {
      for (let n = 1; n <= 8; n++) {
        const { length } = layoutCity(homes, n).gathering.spots;
        assert.ok(length >= 100, `${homes} homes in ${n}: ${length} cells`);
        assert.ok(length >= 1.5 * CROWD_SIZE, `${homes} homes in ${n}: ${length} cells`);
      }
    }
  });
});

describe("scatterCrowd", () => {
  test("gives the crowd its count, numbered from 1", () => {
    assert.equal(crowd.length, CROWD_SIZE);
    assert.deepEqual(
      crowd.map((b) => b.id),
      Array.from({ length: CROWD_SIZE }, (_, i) => i + 1),
    );
  });

  test("stands every blob on its own cell, inside the plaza and clear of the furniture", () => {
    assert.equal(new Set(crowd.map((b) => b.cell)).size, crowd.length);
    for (const b of crowd) {
      assert.deepEqual({ x: b.x, z: b.z }, cells[b.cell]);
      assert.ok(insidePolygon(b, city.gathering.outline), `blob ${b.id} is off the plaza`);
      for (const f of city.furniture) {
        const box = { ...f, kind: "box" as const };
        assert.ok(distanceToObstacle(b, box) >= BLOB_REACH, `blob ${b.id} is in the ${f.kind}`);
      }
    }
  });

  test("the same seed gives the same crowd; another seed gives another", () => {
    assert.deepEqual(scatterCrowd(DEFAULT_CROWD_SEED, cells, CROWD_SIZE), crowd);
    const other = scatterCrowd(DEFAULT_CROWD_SEED + 1, cells, CROWD_SIZE);
    assert.notDeepEqual(other, crowd);
    // Not a near copy: most blobs stand somewhere else or look different.
    const same = other.filter((b, i) => JSON.stringify(b) === JSON.stringify(crowd[i])).length;
    assert.ok(same < 5, `${same} blobs unchanged`);
  });

  test("a crowd of 100 has every shape and every mood", () => {
    for (const seed of SEEDS) {
      const blobs = scatterCrowd(seed, cells, CROWD_SIZE);
      assert.deepEqual(new Set(blobs.map((b) => b.shape)), new Set(SHAPES), `seed ${seed}`);
      assert.deepEqual(new Set(blobs.map((b) => b.mood)), new Set(MOODS), `seed ${seed}`);
    }
  });

  test("shapes and moods are uniform", () => {
    const blobs = SEEDS.flatMap((seed) => scatterCrowd(seed, cells, CROWD_SIZE));
    for (const [values, all] of [
      [blobs.map((b) => b.shape), SHAPES],
      [blobs.map((b) => b.mood), MOODS],
    ] as const) {
      const expected = blobs.length / all.length;
      for (const value of all) {
        const n = values.filter((v) => v === value).length;
        assert.ok(Math.abs(n - expected) < 0.2 * expected, `${value}: ${n} of ${blobs.length}`);
      }
    }
  });

  test("splits ages about 20% child, 60% adult, 20% elder, each an exact age in its band", () => {
    for (const seed of SEEDS) {
      const blobs = scatterCrowd(seed, cells, CROWD_SIZE);
      for (const band of AGE_BANDS) {
        const share = blobs.filter((b) => ageGroup(b.age) === band.group).length / blobs.length;
        assert.ok(Math.abs(share - band.share) <= 0.02, `seed ${seed}, ${band.group}: ${share}`);
      }
      for (const b of blobs) {
        assert.ok(Number.isInteger(b.age) && b.age >= 0 && b.age <= 94, `age ${b.age}`);
      }
    }
    // Every year of every band turns up somewhere.
    const ages = new Set(
      SEEDS.flatMap((seed) => scatterCrowd(seed, cells, CROWD_SIZE)).map((b) => b.age),
    );
    for (let age = 0; age <= 94; age++) assert.ok(ages.has(age), `nobody is ${age}`);
  });

  test("the bands match the age groups the blobs are sized by", () => {
    for (const band of AGE_BANDS) {
      assert.equal(ageGroup(band.from), band.group);
      assert.equal(ageGroup(band.to), band.group);
    }
    assert.equal(
      AGE_BANDS.reduce((sum, b) => sum + b.share, 0),
      1,
    );
  });

  test("faces every blob towards the default camera, give or take FACING_SPREAD", () => {
    const yaws = crowd.map((b) => b.yaw);
    for (const yaw of yaws) assert.ok(Math.abs(yaw) <= FACING_SPREAD);
    assert.ok(Math.min(...yaws) < -0.8 * FACING_SPREAD && Math.max(...yaws) > 0.8 * FACING_SPREAD);
  });

  test("every cell is as likely as any other, not nearest the middle first", () => {
    const trials = 300;
    const hits = new Array<number>(cells.length).fill(0);
    for (let seed = 1; seed <= trials; seed++) {
      for (const b of scatterCrowd(seed, cells, CROWD_SIZE)) hits[b.cell]++;
    }
    const expected = (trials * CROWD_SIZE) / cells.length;
    hits.forEach((n, cell) => {
      assert.ok(Math.abs(n - expected) < 0.35 * expected, `cell ${cell}: ${n}, not ~${expected}`);
    });
  });

  test("fills every cell when asked to, and refuses more blobs than cells", () => {
    const full = scatterCrowd(7, cells, cells.length);
    assert.equal(new Set(full.map((b) => b.cell)).size, cells.length);
    assert.deepEqual(scatterCrowd(7, cells, 0), []);
    const few: Point[] = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
    ];
    assert.throws(() => scatterCrowd(1, few, 3), RangeError);
    assert.throws(() => scatterCrowd(1, cells, -1), RangeError);
    assert.throws(() => scatterCrowd(1, cells, 2.5), RangeError);
  });
});

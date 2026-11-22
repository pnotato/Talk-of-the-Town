/// <reference types="node" />
// Run: node --test web/src/scene/replay.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { moodFor } from "./blobMood.ts";
import {
  headingAt,
  moodAt,
  positionAt,
  type ReplayRun,
  roundAt,
  roundsDone,
  runTicks,
  TICK_SECONDS,
} from "./replay.ts";

// A small hand-made walk on a 3 × 2 patch of the 1.8 grid, 4 ticks a round so nothing leans on
// the real 10. Three blobs, two rounds, at least 1.8 apart throughout:
//
//   z = 1.8   3  4  5
//   z = 0     0  1  2
//             x = 0, 1.8, 3.6
const FIXTURE: ReplayRun = {
  town: {
    blobs: [
      { perception: 50, interest: 20 },
      { perception: 50, interest: 20 },
      { perception: 50, interest: 20 },
    ],
  },
  map: {
    nodes: [
      [0, 0],
      [1.8, 0],
      [3.6, 0],
      [0, 1.8],
      [1.8, 1.8],
      [3.6, 1.8],
    ],
    stand: 6,
    ticksPerRound: 4,
  },
  start: [0, 2, 4],
  rounds: [
    {
      perception: [70, 30, 10],
      interest: [40, 60, 5],
      paths: [
        [0, 3, 3, 4, 4], // up, wait, right, wait
        [2, 1, 0, 0, 0], // left twice, then stands
        [4, 5, 5, 5, 2], // right, waits, then down
      ],
    },
    {
      perception: [50, 50, 50],
      interest: [10, 80, 30],
      paths: [
        [4, 4, 4, 4, 4], // stands the whole round
        [0, 1, 1, 1, 1],
        [2, 2, 5, 5, 5],
      ],
    },
  ],
};
const T = FIXTURE.map.ticksPerRound;
const BLOBS = FIXTURE.start.length;

function node(run: ReplayRun, i: number) {
  const [x, z] = run.map.nodes[i];
  return { x, z };
}

function at(run: ReplayRun, b: number, t: number, snap = false) {
  return positionAt(run, b, t, { x: NaN, z: NaN }, snap);
}

/** The closest any two blobs come, sampled every `step` ticks over the whole run. */
function closestPair(run: ReplayRun, step: number) {
  const n = run.start.length;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const out = { x: 0, z: 0 };
  const samples = Math.round(runTicks(run) / step);
  let closest = { d: Infinity, t: 0, a: -1, b: -1 };
  for (let s = 0; s <= samples; s++) {
    const t = s * step;
    for (let b = 0; b < n; b++) {
      positionAt(run, b, t, out);
      xs[b] = out.x;
      zs[b] = out.z;
    }
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const d = Math.hypot(xs[a] - xs[b], zs[a] - zs[b]);
        if (d < closest.d) closest = { d, t, a, b };
      }
    }
  }
  return closest;
}

describe("the clock", () => {
  test("a tick is a 1.8 step at 3 units a second, a full stride in blobMotion", () => {
    assert.equal(TICK_SECONDS, 0.6);
  });

  test("the run lasts rounds × ticks per round", () => {
    assert.equal(runTicks(FIXTURE), 2 * T);
    assert.equal(runTicks({ ...FIXTURE, rounds: [] }), 0);
  });

  test("roundAt is the round whose walk is playing, held on the last at the end", () => {
    assert.equal(roundAt(FIXTURE, 0), 0);
    assert.equal(roundAt(FIXTURE, T - 0.01), 0);
    assert.equal(roundAt(FIXTURE, T), 1);
    assert.equal(roundAt(FIXTURE, 2 * T), 1);
    assert.equal(roundAt(FIXTURE, 99), 1);
    assert.equal(roundAt(FIXTURE, -1), 0);
    assert.equal(roundAt({ ...FIXTURE, rounds: [] }, 3), 0);
  });

  test("roundsDone counts the walks that have finished: a round ends as its walk does", () => {
    assert.equal(roundsDone(FIXTURE, 0), 0);
    assert.equal(roundsDone(FIXTURE, T - 0.01), 0);
    assert.equal(roundsDone(FIXTURE, T), 1);
    assert.equal(roundsDone(FIXTURE, 2 * T - 0.01), 1);
    assert.equal(roundsDone(FIXTURE, 2 * T), 2);
    assert.equal(roundsDone(FIXTURE, 99), 2);
    assert.equal(roundsDone(FIXTURE, -1), 0);
    assert.equal(roundsDone({ ...FIXTURE, rounds: [] }, 3), 0);
  });
});

describe("positionAt", () => {
  test("is exactly on the path's node at every whole tick", () => {
    FIXTURE.rounds.forEach(({ paths }, r) => {
      for (let k = 0; k <= T; k++) {
        for (let b = 0; b < BLOBS; b++) {
          assert.deepEqual(at(FIXTURE, b, r * T + k), node(FIXTURE, paths[b][k]), `r${r} k${k}`);
        }
      }
    });
  });

  test("is linear between ticks: straight and at constant speed", () => {
    for (let b = 0; b < BLOBS; b++) {
      for (let k = 0; k < runTicks(FIXTURE); k++) {
        const from = at(FIXTURE, b, k);
        const to = at(FIXTURE, b, k + 1);
        for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
          const p = at(FIXTURE, b, k + f);
          assert.ok(Math.abs(p.x - (from.x + f * (to.x - from.x))) < 1e-12, `b${b} t${k + f}`);
          assert.ok(Math.abs(p.z - (from.z + f * (to.z - from.z))) < 1e-12, `b${b} t${k + f}`);
        }
      }
    }
  });

  test("is continuous across round boundaries", () => {
    for (let r = 1; r < FIXTURE.rounds.length; r++) {
      for (let b = 0; b < BLOBS; b++) {
        assert.deepEqual(
          node(FIXTURE, FIXTURE.rounds[r - 1].paths[b][T]),
          node(FIXTURE, FIXTURE.rounds[r].paths[b][0]),
          "the fixture's rounds join up",
        );
        const before = at(FIXTURE, b, r * T - 1e-9);
        const after = at(FIXTURE, b, r * T);
        assert.ok(Math.hypot(before.x - after.x, before.z - after.z) < 1e-6, `b${b} round ${r}`);
      }
    }
  });

  test("is clamped to the start and the end of the run", () => {
    const end = runTicks(FIXTURE);
    for (let b = 0; b < BLOBS; b++) {
      assert.deepEqual(at(FIXTURE, b, -3), at(FIXTURE, b, 0));
      assert.deepEqual(at(FIXTURE, b, end + 5), at(FIXTURE, b, end));
      assert.deepEqual(at(FIXTURE, b, end), node(FIXTURE, FIXTURE.rounds[1].paths[b][T]));
    }
  });

  test("stands every blob on its start node before there are any rounds", () => {
    const empty = { ...FIXTURE, rounds: [] };
    for (let b = 0; b < BLOBS; b++) {
      for (const t of [0, 0.5, 7]) {
        assert.deepEqual(at(empty, b, t), node(empty, empty.start[b]));
      }
    }
  });

  test("snaps to the last whole tick when asked (reduced motion)", () => {
    for (let b = 0; b < BLOBS; b++) {
      for (let k = 0; k < runTicks(FIXTURE); k++) {
        for (const f of [0, 0.3, 0.99]) {
          assert.deepEqual(at(FIXTURE, b, k + f, true), at(FIXTURE, b, k), `b${b} t${k + f}`);
        }
      }
      const end = runTicks(FIXTURE);
      assert.deepEqual(at(FIXTURE, b, end, true), at(FIXTURE, b, end));
    }
  });

  test("writes into the object it is given and returns it", () => {
    const out = { x: 0, z: 0 };
    assert.equal(positionAt(FIXTURE, 0, 1, out), out);
    assert.deepEqual(out, node(FIXTURE, 3));
  });
});

describe("headingAt", () => {
  test("faces along the step being taken; 0 faces +z", () => {
    assert.equal(headingAt(FIXTURE, 0, 0.5), 0); // 0 → 3: +z
    assert.equal(headingAt(FIXTURE, 0, 2.5), Math.PI / 2); // 3 → 4: +x
    assert.equal(headingAt(FIXTURE, 1, 0), -Math.PI / 2); // 2 → 1: -x
    assert.equal(headingAt(FIXTURE, 2, 3.5), Math.PI); // 5 → 2: -z
  });

  test("is null while a blob stands, before any rounds, and on a last tick spent standing", () => {
    assert.equal(headingAt(FIXTURE, 0, 1.5), null);
    for (const t of [T, T + 1.5, 2 * T - 0.01, 2 * T, 99]) {
      assert.equal(headingAt(FIXTURE, 0, t), null, `t ${t}`);
    }
    assert.equal(headingAt({ ...FIXTURE, rounds: [] }, 0, 0), null);
  });

  test("lets the caller hold the last yaw while a blob stands", () => {
    // What CityReplay does each frame.
    let yaw = 0;
    const seen: number[] = [];
    for (let s = 0; s <= 2 * T * 10; s++) {
      const heading = headingAt(FIXTURE, 0, s / 10);
      if (heading !== null) yaw = heading;
      seen.push(yaw);
    }
    // Up, then held through the wait; right, then held through the wait and all of round 1.
    assert.deepEqual(seen.slice(0, 20), new Array(20).fill(0));
    assert.deepEqual(seen.slice(20), new Array(seen.length - 20).fill(Math.PI / 2));
  });
});

describe("moodAt", () => {
  test("uses the town's starting scores until round 0 is done", () => {
    for (let b = 0; b < BLOBS; b++) {
      const { perception, interest } = FIXTURE.town.blobs[b];
      assert.equal(moodAt(FIXTURE, b, 0), moodFor(perception, interest));
    }
  });

  test("then the scores after the last round that is done", () => {
    assert.deepEqual(
      [0, 1, 2].map((b) => moodAt(FIXTURE, b, 1)),
      ["smile", "worried", "angry"],
    );
    assert.deepEqual(
      [0, 1, 2].map((b) => moodAt(FIXTURE, b, 2)),
      ["sleepy", "o", "flat"],
    );
    assert.equal(moodAt(FIXTURE, 1, roundsDone(FIXTURE, T + 1)), "worried");
  });
});

describe("blobs never touch", () => {
  // TODO(walk-replay): run this on internal/sim/testdata/golden_run.json, read with node:fs,
  // once the Go side writes its walks there.
  test("every pair stays at least 1.2 apart, sampled every 0.05 tick", (t) => {
    const closest = closestPair(FIXTURE, 0.05);
    t.diagnostic(
      `closest pair: blobs ${closest.a} and ${closest.b}, ${closest.d.toFixed(4)} apart at tick ${closest.t}`,
    );
    assert.ok(closest.d >= 1.2 - 0.005, JSON.stringify(closest));
  });
});

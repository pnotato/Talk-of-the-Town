/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  heightShare,
  markersAt,
  pulseAt,
  pulseDomain,
  pulseSeries,
  roundShare,
  roundsDoneAt,
  sparkArea,
  sparkPath,
  type PulseRun,
} from "./timeline.ts";

function run(): PulseRun {
  return {
    town: {
      blobs: [
        { perception: 40, interest: 10 },
        { perception: 60, interest: 30 },
      ],
    },
    rounds: [
      { avgPerception: 52, avgInterest: 24 },
      { avgPerception: 55, avgInterest: 30 },
      { avgPerception: 61, avgInterest: 35 },
      { avgPerception: 58, avgInterest: 41 },
    ],
    moments: [
      { id: "m0", round: 0, headline: "First" },
      { id: "m1", round: 2, headline: "Second" },
    ],
    next: null,
  };
}

describe("pulseSeries", () => {
  test("starts from the town's starting average, then one point per round", () => {
    const series = pulseSeries(run());
    assert.deepEqual(series.perception, [50, 52, 55, 61, 58]);
    assert.deepEqual(series.interest, [20, 24, 30, 35, 41]);
  });

  test("an empty town starts at zero rather than NaN", () => {
    const series = pulseSeries({ ...run(), town: { blobs: [] } });
    assert.equal(series.perception[0], 0);
    assert.equal(series.interest[0], 0);
  });
});

describe("pulseDomain", () => {
  test("spans the whole run in tens, so the chart's scale never shifts while it plays", () => {
    assert.deepEqual(pulseDomain(pulseSeries(run())), [20, 70]);
  });

  test("is never narrower than 20 points, and stays within 0–100", () => {
    assert.deepEqual(pulseDomain({ perception: [51, 52], interest: [53] }), [40, 60]);
    assert.deepEqual(pulseDomain({ perception: [1, 2], interest: [3] }), [0, 20]);
    assert.deepEqual(pulseDomain({ perception: [99], interest: [98] }), [80, 100]);
    assert.deepEqual(pulseDomain({ perception: [], interest: [] }), [0, 100]);
  });
});

describe("roundsDoneAt", () => {
  test("is the playing round's index until the replay ends, then every round", () => {
    assert.equal(roundsDoneAt(0, false, 4), 0);
    assert.equal(roundsDoneAt(3, false, 4), 3);
    assert.equal(roundsDoneAt(3, true, 4), 4);
  });

  test("stays inside the run", () => {
    assert.equal(roundsDoneAt(-2, false, 4), 0);
    assert.equal(roundsDoneAt(9, false, 4), 4);
  });
});

describe("pulseAt", () => {
  test("reads the scores after the rounds that are done, rounded for display", () => {
    const series = pulseSeries(run());
    assert.deepEqual(pulseAt(series, 0), { perception: 50, interest: 20 });
    assert.deepEqual(pulseAt(series, 2), { perception: 55, interest: 30 });
    assert.deepEqual(pulseAt(series, 99), { perception: 58, interest: 41 });
  });
});

describe("roundShare", () => {
  test("spreads round starts across the bar and clamps to it", () => {
    assert.equal(roundShare(0, 4), 0);
    assert.equal(roundShare(2, 4), 0.5);
    assert.equal(roundShare(4, 4), 1);
    assert.equal(roundShare(9, 4), 1);
    assert.equal(roundShare(1, 0), 0);
  });
});

describe("sparkPath", () => {
  test("draws only the points that are done, with 100 at the top", () => {
    assert.equal(sparkPath([0, 50, 100, 25], 2, 4, 400, 20), "M0 20 L100 10 L200 0");
  });

  test("is empty before there is anything to draw", () => {
    assert.equal(sparkPath([], 3, 4, 400, 20), "");
    assert.equal(sparkPath([50], 0, 0, 400, 20), "");
  });

  test("clamps scores outside 0–100 to the chart", () => {
    assert.equal(sparkPath([-10, 140], 1, 1, 10, 10), "M0 10 L10 0");
  });

  test("maps a narrower domain onto the full height", () => {
    assert.equal(sparkPath([40, 50, 60], 2, 2, 20, 10, [40, 60]), "M0 10 L10 5 L20 0");
  });
});

describe("sparkArea", () => {
  test("closes the line down to the floor and back to the start", () => {
    assert.equal(
      sparkArea([0, 50, 100, 25], 2, 4, 400, 20),
      "M0 20 L100 10 L200 0 L200 20 L0 20 Z",
    );
  });

  test("is empty when there is no line", () => {
    assert.equal(sparkArea([], 3, 4, 400, 20), "");
  });
});

describe("heightShare", () => {
  test("places a score within the domain, clamped to it", () => {
    assert.equal(heightShare(50), 0.5);
    assert.equal(heightShare(45, [40, 60]), 0.25);
    assert.equal(heightShare(80, [40, 60]), 1);
    assert.equal(heightShare(10, [40, 60]), 0);
  });

  test("is 0 for an empty domain", () => {
    assert.equal(heightShare(50, [50, 50]), 0);
  });
});

describe("markersAt", () => {
  test("names the announcements already made and keeps the rest unnamed", () => {
    assert.deepEqual(markersAt(run(), 1), [
      { id: "m0", share: 0, round: 1, headline: "First", past: true },
      { id: "m1", share: 0.5, round: 3, headline: null, past: false },
    ]);
    assert.equal(markersAt(run(), 2)[1].headline, "Second");
  });

  test("adds the pending announcement as one still to come", () => {
    const pending = { ...run(), moments: run().moments.slice(0, 1), next: { id: "m1", round: 2 } };
    assert.deepEqual(markersAt(pending, 0)[1], {
      id: "m1",
      share: 0.5,
      round: 3,
      headline: null,
      past: false,
    });
  });
});

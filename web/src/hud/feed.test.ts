/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { feedAt, headlineAt, shipVerdict, type FeedMoment } from "./feed.ts";

function moment(overrides: Partial<FeedMoment>): FeedMoment {
  return {
    id: "m0",
    round: 0,
    headline: "Wick launches",
    claimed: 40,
    delivered: 40,
    shipped: true,
    shippedRound: 8,
    broken: false,
    ...overrides,
  };
}

const MOMENTS = [
  moment({ id: "m0", round: 0, headline: "First", shippedRound: 8 }),
  moment({ id: "m1", round: 10, headline: "Second", claimed: 30, delivered: 45, shippedRound: 18 }),
  moment({ id: "m2", round: 20, headline: "Third", shipped: false, shippedRound: -1 }),
];

describe("shipVerdict", () => {
  test("a broken promise wins over the numbers", () => {
    assert.equal(shipVerdict(moment({ claimed: 30, delivered: 45, broken: true })), "broken");
  });

  test("beating the claim, or keeping to it", () => {
    assert.equal(shipVerdict(moment({ claimed: 30, delivered: 45 })), "beat");
    assert.equal(shipVerdict(moment({ claimed: 40, delivered: 40 })), "kept");
    // Short of the claim, but the sim didn't call it broken.
    assert.equal(shipVerdict(moment({ claimed: 50, delivered: 45 })), "kept");
  });
});

describe("feedAt", () => {
  test("shows only what has happened by the playing round, newest first", () => {
    assert.deepEqual(
      feedAt(MOMENTS, 0).map((item) => item.key),
      ["m0-announced"],
    );
    assert.deepEqual(
      feedAt(MOMENTS, 10).map((item) => item.key),
      ["m1-announced", "m0-shipped", "m0-announced"],
    );
    assert.deepEqual(
      feedAt(MOMENTS, 49).map((item) => item.key),
      ["m2-announced", "m1-shipped", "m1-announced", "m0-shipped", "m0-announced"],
    );
  });

  test("numbers rounds from 1, as the playback bar does", () => {
    const [shipped, announced] = feedAt(MOMENTS, 8);
    assert.equal(shipped.round, 9);
    assert.equal(shipped.kind, "shipped");
    assert.equal(shipped.verdict, "kept");
    assert.equal(announced.round, 1);
    assert.equal(announced.kind, "announced");
    assert.equal(announced.verdict, undefined);
  });

  test("a ship in the same round as an announcement comes first, as it happened later", () => {
    const same = [moment({ id: "a", round: 0, shippedRound: 4 }), moment({ id: "b", round: 4 })];
    assert.deepEqual(
      feedAt(same, 4).map((item) => item.key),
      ["a-shipped", "b-announced", "a-announced"],
    );
  });
});

describe("headlineAt", () => {
  test("is the latest announcement made by the playing round", () => {
    assert.equal(headlineAt(MOMENTS, 0)?.headline, "First");
    assert.equal(headlineAt(MOMENTS, 15)?.headline, "Second");
    assert.equal(headlineAt([], 5), undefined);
  });
});

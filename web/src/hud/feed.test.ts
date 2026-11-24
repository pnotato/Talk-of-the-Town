/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RunEvent, RunLog } from "../generated/types.ts";
import { feedAt, headlineAt, postsAt, shipVerdict, type FeedMoment } from "./feed.ts";

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

describe("postsAt", () => {
  const blob = (id: number, name: string) => ({ id, name }) as RunLog["town"]["blobs"][number];
  const event = (overrides: Partial<RunEvent>): RunEvent => ({
    f: 0,
    to: [1, 2],
    p: true,
    s: false,
    c: 50,
    dp: [0, 0],
    di: [0, 0],
    w: "",
    t: "",
    r: [],
    ...overrides,
  });
  const round = (events: RunEvent[]) => ({ events }) as RunLog["rounds"][number];
  const run = {
    town: { blobs: [blob(0, "Ada"), blob(1, "Bo"), blob(2, "Cy")] } as RunLog["town"],
    rounds: [
      round([
        event({ w: "First post", t: "Why not.", r: ["Nice.", "Meh."] }),
        event({ p: false, to: [2], w: "A talk, not a post" }),
      ]),
      round([
        event({ f: 1, to: [0, 2], w: "Second post", t: "Hype!", r: ["", "Wow."] }),
        event({ w: "" }), // a post without words: a run from before the voice
      ]),
    ],
  };

  test("lists posts with words up to the playing round, newest first", () => {
    assert.deepEqual(
      postsAt(run, 1).map((post) => [post.round, post.author, post.words, post.thought]),
      [
        [2, "Bo", "Second post", "Hype!"],
        [1, "Ada", "First post", "Why not."],
      ],
    );
    assert.deepEqual(
      postsAt(run, 0).map((post) => post.words),
      ["First post"],
    );
  });

  test("names the readers who reacted, and skips the ones who didn't", () => {
    const [second, first] = postsAt(run, 1);
    assert.deepEqual(second.replies, [{ id: 2, name: "Cy", thought: "Wow." }]);
    assert.deepEqual(first.replies, [
      { id: 1, name: "Bo", thought: "Nice." },
      { id: 2, name: "Cy", thought: "Meh." },
    ]);
  });

  test("stops at the limit", () => {
    assert.equal(postsAt(run, 1, 1).length, 1);
  });
});

/// <reference types="node" />
// Run: node --experimental-strip-types --test web/src/inspector/*.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Emotions } from "../generated/types.ts";
import { moodFor } from "../scene/blobMood.ts";
import {
  activityText,
  capitalise,
  describeAction,
  displayScore,
  emotionShares,
  interestLabel,
  perceptionLabel,
  sameActivity,
  stepSelection,
} from "./inspectorModel.ts";

describe("score words", () => {
  test("change at the same edges as moodFor's bands", () => {
    // moodFor(p, 50) crosses a band exactly where the words do.
    for (const p of [19, 20, 37, 38, 61, 62]) {
      const changesHere = moodFor(p, 50) !== moodFor(p - 1, 50);
      assert.equal(perceptionLabel(p) !== perceptionLabel(p - 1), changesHere, `perception ${p}`);
    }
    const edges: [number, string][] = [
      [14, "Not interested"],
      [15, "Mildly interested"],
      [49, "Mildly interested"],
      [50, "Interested"],
      [69, "Interested"],
      [70, "Very interested"],
    ];
    for (const [score, words] of edges) assert.equal(interestLabel(score), words);
    assert.deepEqual([0, 19, 20, 37, 38, 61, 62, 100].map(perceptionLabel), [
      "Hostile",
      "Hostile",
      "Doubtful",
      "Doubtful",
      "Undecided",
      "Undecided",
      "Favourable",
      "Favourable",
    ]);
  });

  test("clamp and round for display", () => {
    assert.deepEqual([-5, 0, 49.5, 72.4, 100, 130].map(displayScore), [0, 0, 50, 72, 100, 100]);
  });
});

describe("activities", () => {
  test("read plainly, idle when the scene has said nothing", () => {
    assert.equal(activityText(undefined), "Idle");
    assert.equal(activityText({ state: "posting", mood: "o" }), "Posting to social media");
    assert.equal(activityText({ state: "scrolling", mood: "flat" }), "Scrolling social media");
    assert.equal(activityText({ state: "talking", mood: "smile", partnerId: 2 }), "Talking");
  });

  test("compare by value, so repeated reports can be skipped", () => {
    const a = { state: "talking", mood: "smile", partnerId: 2 } as const;
    assert.ok(sameActivity({ ...a }, a));
    assert.ok(!sameActivity(undefined, a));
    assert.ok(!sameActivity({ ...a, partnerId: 3 }, a));
    assert.ok(!sameActivity({ ...a, state: "listening" }, a));
    assert.ok(!sameActivity({ ...a, mood: "flat" }, a));
    assert.ok(sameActivity({ state: "idle", mood: "smile" }, { state: "idle", mood: "smile" }));
  });

  test("counts a score change as a new activity, and ignores scores when neither has them", () => {
    const a = { state: "idle", mood: "flat", perception: 50, interest: 20 } as const;
    assert.ok(sameActivity({ ...a }, a));
    assert.ok(!sameActivity({ ...a, perception: 51 }, a));
    assert.ok(!sameActivity({ ...a, interest: 21 }, a));
    assert.ok(sameActivity({ state: "idle", mood: "flat" }, { state: "idle", mood: "flat" }));
  });

  test("counts an emotion change as a new activity, comparing shares rather than objects", () => {
    const a = { state: "idle", mood: "flat", emotions: { ...CALM } } as const;
    assert.ok(sameActivity({ ...a, emotions: { ...CALM } }, a));
    assert.ok(!sameActivity({ ...a, emotions: { ...CALM, calm: 90, anger: 10 } }, a));
    assert.ok(!sameActivity({ state: "idle", mood: "flat" }, a));
  });
});

const CALM: Emotions = { calm: 100, joy: 0, trust: 0, surprise: 0, fear: 0, sadness: 0, anger: 0 };

describe("emotionShares", () => {
  test("lists the shares biggest first, leaving out the empty ones", () => {
    assert.deepEqual(emotionShares({ ...CALM, calm: 20, anger: 50, sadness: 30 }), [
      { emotion: "anger", percent: 50 },
      { emotion: "sadness", percent: 30 },
      { emotion: "calm", percent: 20 },
    ]);
    assert.deepEqual(emotionShares(CALM), [{ emotion: "calm", percent: 100 }]);
  });

  test("always adds up to 100, though the logged shares are each rounded", () => {
    for (const mix of [
      { ...CALM, calm: 34, joy: 33, trust: 34 }, // 101
      { ...CALM, calm: 33, joy: 33, trust: 33 }, // 99
      { ...CALM, calm: 14, joy: 15, trust: 14, surprise: 15, fear: 14, sadness: 14, anger: 15 },
    ]) {
      const shares = emotionShares(mix);
      assert.equal(
        shares.reduce((sum, s) => sum + s.percent, 0),
        100,
        JSON.stringify(mix),
      );
    }
  });

  test("breaks ties in the emotions' own order, and is empty for an empty mix", () => {
    assert.deepEqual(
      emotionShares({ ...CALM, calm: 50, anger: 50 }).map((s) => s.emotion),
      ["calm", "anger"],
    );
    assert.deepEqual(
      emotionShares({ ...CALM, calm: 0, joy: 50, trust: 50 }).map((s) => s.emotion),
      ["joy", "trust"],
    );
    assert.deepEqual(emotionShares({ ...CALM, calm: 0 }), []);
  });
});

describe("describeAction", () => {
  test("joins talking and listening to their partner, and says nothing more than the scene did", () => {
    assert.deepEqual(describeAction({ state: "talking", mood: "smile", partnerId: 7 }), {
      text: "Talking to",
      partnerId: 7,
    });
    assert.deepEqual(describeAction({ state: "listening", mood: "flat", partnerId: 2 }), {
      text: "Listening to",
      partnerId: 2,
    });
    assert.deepEqual(describeAction({ state: "talking", mood: "smile" }), { text: "Talking" });
  });

  test("never attaches a partner to posting, scrolling, walking or idle, or invents an action", () => {
    for (const state of ["posting", "scrolling", "walking", "idle"] as const) {
      const { partnerId } = describeAction({ state, mood: "flat", partnerId: 3 });
      assert.equal(partnerId, undefined, state);
    }
    assert.deepEqual(describeAction(undefined), { text: "Idle" });
    assert.equal(describeAction({ state: "posting", mood: "o" }).text, "Posting to social media");
    assert.equal(describeAction({ state: "scrolling", mood: "o" }).text, "Scrolling social media");
  });
});

describe("stepSelection", () => {
  const order = [5, 6, 7];

  test("moves through the order and wraps at both ends", () => {
    assert.equal(stepSelection(order, 5, 1), 6);
    assert.equal(stepSelection(order, 7, 1), 5);
    assert.equal(stepSelection(order, 5, -1), 7);
    assert.equal(stepSelection(order, 6, -1), 5);
  });

  test("starts at the first going forward and the last going back from nothing or an unknown id", () => {
    assert.equal(stepSelection(order, null, 1), 5);
    assert.equal(stepSelection(order, null, -1), 7);
    assert.equal(stepSelection(order, 99, 1), 5);
    assert.equal(stepSelection([], 1, 1), null);
  });
});

test("capitalise", () => {
  assert.equal(capitalise("square"), "Square");
  assert.equal(capitalise(""), "");
});

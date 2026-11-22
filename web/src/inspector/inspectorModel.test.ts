/// <reference types="node" />
// Run: node --experimental-strip-types --test web/src/inspector/*.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { moodFor } from "../scene/blobMood.ts";
import {
  activityText,
  capitalise,
  describeAction,
  displayScore,
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

  test("never attaches a partner to posting, walking or idle, or invents an action", () => {
    for (const state of ["posting", "walking", "idle"] as const) {
      const { partnerId } = describeAction({ state, mood: "flat", partnerId: 3 });
      assert.equal(partnerId, undefined, state);
    }
    assert.deepEqual(describeAction(undefined), { text: "Idle" });
    assert.equal(describeAction({ state: "posting", mood: "o" }).text, "Posting to social media");
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

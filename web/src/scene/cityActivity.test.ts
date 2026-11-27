/// <reference types="node" />
// Run: node --test web/src/scene/cityActivity.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { RunLog } from "../generated/types.ts";
import { moodForEmotions } from "./blobMood.ts";
import { cityActivities } from "./cityActivity.ts";
import { emotionsAt } from "./replay.ts";

const GOLDEN = JSON.parse(
  readFileSync(new URL("../../../internal/sim/testdata/golden_run.json", import.meta.url), "utf8"),
) as RunLog;
const COUNT = GOLDEN.town.blobs.length;

/** What the sim's events say each blob does in a round, by the reporting's precedence. */
function roles(run: RunLog, round: number) {
  const posters = new Set<number>();
  const scrollers = new Set<number>();
  const speakers = new Map<number, number>();
  const listeners = new Map<number, number>();
  for (const event of run.rounds[round].events) {
    if (event.p) {
      posters.add(event.f);
      continue;
    }
    if (event.s) {
      scrollers.add(event.f);
      continue;
    }
    if (event.to.length !== 1) continue;
    const listener = event.to[0];
    if (!speakers.has(event.f)) speakers.set(event.f, listener);
    if (!listeners.has(listener)) listeners.set(listener, event.f);
  }
  return { posters, scrollers, speakers, listeners };
}

function moves(run: RunLog, round: number, blob: number): boolean {
  const path = run.rounds[round].paths[blob];
  for (let k = 1; k < path.length; k++) if (path[k] !== path[k - 1]) return true;
  return false;
}

describe("cityActivities", () => {
  test("reports the sim's talks, posts, scrolls, walks and idles for a round", () => {
    const round = 0;
    const activities = cityActivities(GOLDEN, round, 0);
    const { posters, scrollers, speakers, listeners } = roles(GOLDEN, round);

    assert.equal(Object.keys(activities).length, COUNT);
    for (let b = 0; b < COUNT; b++) {
      const activity = activities[b];
      assert.ok(activity, `blob ${b}`);
      if (posters.has(b)) {
        assert.equal(activity.state, "posting", `blob ${b}`);
        assert.equal(activity.partnerId, undefined, `blob ${b}`);
      } else if (scrollers.has(b)) {
        assert.equal(activity.state, "scrolling", `blob ${b}`);
        assert.equal(activity.partnerId, undefined, `blob ${b}`);
      } else if (speakers.has(b)) {
        assert.equal(activity.state, "talking", `blob ${b}`);
        assert.equal(activity.partnerId, speakers.get(b), `blob ${b}`);
      } else if (listeners.has(b)) {
        assert.equal(activity.state, "listening", `blob ${b}`);
        assert.equal(activity.partnerId, listeners.get(b), `blob ${b}`);
      } else {
        assert.equal(activity.state, moves(GOLDEN, round, b) ? "walking" : "idle", `blob ${b}`);
        assert.equal(activity.partnerId, undefined, `blob ${b}`);
      }
    }
  });

  test("reports blobs scrolling social media when the sim records it", () => {
    let found = false;
    for (const [r, round] of GOLDEN.rounds.entries()) {
      const scrollers = new Set(round.events.filter((e) => e.s).map((e) => e.f));
      if (scrollers.size === 0) continue;
      found = true;
      const activities = cityActivities(GOLDEN, r, 0);
      for (const b of scrollers)
        assert.equal(activities[b].state, "scrolling", `round ${r} blob ${b}`);
    }
    assert.ok(found, "the golden run records no scrolls");
  });

  test("uses the town's starting scores before round 0 is done", () => {
    const activities = cityActivities(GOLDEN, 0, 0);
    for (let b = 0; b < COUNT; b++) {
      const blob = GOLDEN.town.blobs[b];
      assert.equal(activities[b].perception, blob.perception, `blob ${b}`);
      assert.equal(activities[b].interest, blob.interest, `blob ${b}`);
      assert.deepEqual(activities[b].emotions, blob.emotions, `blob ${b}`);
      assert.equal(activities[b].mood, moodForEmotions(blob.emotions), `blob ${b}`);
    }
  });

  test("uses the completed round's scores once a round is done", () => {
    const activities = cityActivities(GOLDEN, 1, 1);
    const completed = GOLDEN.rounds[0];
    for (let b = 0; b < COUNT; b++) {
      assert.equal(activities[b].perception, completed.perception[b], `blob ${b}`);
      assert.equal(activities[b].interest, completed.interest[b], `blob ${b}`);
      assert.equal(activities[b].emotions?.anger, completed.emotions.anger[b], `blob ${b}`);
      assert.deepEqual(activities[b].emotions, emotionsAt(GOLDEN, b, 1), `blob ${b}`);
      assert.equal(activities[b].mood, moodForEmotions(emotionsAt(GOLDEN, b, 1)), `blob ${b}`);
    }
  });

  test("reports a later round's roles while keeping the completed scores", () => {
    const round = 1;
    const activities = cityActivities(GOLDEN, round, 1);
    const { posters, scrollers, speakers, listeners } = roles(GOLDEN, round);
    for (let b = 0; b < COUNT; b++) {
      const activity = activities[b];
      if (posters.has(b)) assert.equal(activity.state, "posting", `blob ${b}`);
      else if (scrollers.has(b)) assert.equal(activity.state, "scrolling", `blob ${b}`);
      else if (speakers.has(b)) {
        assert.equal(activity.state, "talking", `blob ${b}`);
        assert.equal(activity.partnerId, speakers.get(b), `blob ${b}`);
      } else if (listeners.has(b)) {
        assert.equal(activity.state, "listening", `blob ${b}`);
        assert.equal(activity.partnerId, listeners.get(b), `blob ${b}`);
      }
      assert.equal(activity.perception, GOLDEN.rounds[0].perception[b], `blob ${b}`);
    }
  });

  test("has everyone idle, on their starting scores, before any round", () => {
    const activities = cityActivities({ ...GOLDEN, rounds: [] }, 0, 0);
    for (let b = 0; b < COUNT; b++) {
      assert.equal(activities[b].state, "idle", `blob ${b}`);
      assert.equal(activities[b].perception, GOLDEN.town.blobs[b].perception, `blob ${b}`);
    }
  });

  test("reports what blobs said, heard and thought, when the run has words", () => {
    const event = { dp: [1], di: [1], c: 50, p: false, s: false };
    const events = [
      { ...event, f: 1, to: [2], w: "Did you hear?", t: "Must tell them.", r: ["Neat."] },
      {
        ...event,
        f: 3,
        to: [4, 5],
        p: true,
        dp: [1, 1],
        di: [1, 1],
        w: "Big news!",
        t: "Sharing.",
        r: ["Wow.", "Meh."],
      },
      { ...event, f: 6, to: [3], s: true, w: "Big news!", t: "Hm.", r: [] },
    ];
    const run = { ...GOLDEN, rounds: [{ ...GOLDEN.rounds[0], events }] };
    const a = cityActivities(run, 0, 0);
    assert.deepEqual(
      [a[1].says, a[1].thought, a[1].heard],
      ["Did you hear?", "Must tell them.", undefined],
    );
    assert.deepEqual([a[2].heard, a[2].thought, a[2].says], ["Did you hear?", "Neat.", undefined]);
    assert.deepEqual([a[3].state, a[3].says, a[3].thought], ["posting", "Big news!", "Sharing."]);
    assert.deepEqual([a[5].heard, a[5].thought], ["Big news!", "Meh."]);
    assert.deepEqual([a[6].state, a[6].heard, a[6].thought], ["scrolling", "Big news!", "Hm."]);
    assert.equal(a[7].thought, undefined);
  });

  test("adds no words for a run without them", () => {
    const activities = cityActivities(GOLDEN, 1, 1);
    for (let b = 0; b < COUNT; b++) {
      const { says, heard, thought } = activities[b];
      assert.deepEqual([says, heard, thought], [undefined, undefined, undefined], `blob ${b}`);
    }
  });
});

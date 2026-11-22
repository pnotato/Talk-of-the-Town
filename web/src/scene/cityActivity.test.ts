/// <reference types="node" />
// Run: node --test web/src/scene/cityActivity.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { RunLog } from "../generated/types.ts";
import { moodFor } from "./blobMood.ts";
import { cityActivities } from "./cityActivity.ts";

const GOLDEN = JSON.parse(
  readFileSync(new URL("../../../internal/sim/testdata/golden_run.json", import.meta.url), "utf8"),
) as RunLog;
const COUNT = GOLDEN.town.blobs.length;

/** What the sim's events say each blob does in a round, by the reporting's precedence. */
function roles(run: RunLog, round: number) {
  const posters = new Set<number>();
  const speakers = new Map<number, number>();
  const listeners = new Map<number, number>();
  for (const event of run.rounds[round].events) {
    if (event.p) {
      posters.add(event.f);
      continue;
    }
    if (event.to.length !== 1) continue;
    const listener = event.to[0];
    if (!speakers.has(event.f)) speakers.set(event.f, listener);
    if (!listeners.has(listener)) listeners.set(listener, event.f);
  }
  return { posters, speakers, listeners };
}

function moves(run: RunLog, round: number, blob: number): boolean {
  const path = run.rounds[round].paths[blob];
  for (let k = 1; k < path.length; k++) if (path[k] !== path[k - 1]) return true;
  return false;
}

describe("cityActivities", () => {
  test("reports the sim's talks, posts, walks and idles for a round", () => {
    const round = 0;
    const activities = cityActivities(GOLDEN, round, 0);
    const { posters, speakers, listeners } = roles(GOLDEN, round);

    assert.equal(Object.keys(activities).length, COUNT);
    for (let b = 0; b < COUNT; b++) {
      const activity = activities[b];
      assert.ok(activity, `blob ${b}`);
      if (posters.has(b)) {
        assert.equal(activity.state, "posting", `blob ${b}`);
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

  test("uses the town's starting scores before round 0 is done", () => {
    const activities = cityActivities(GOLDEN, 0, 0);
    for (let b = 0; b < COUNT; b++) {
      const blob = GOLDEN.town.blobs[b];
      assert.equal(activities[b].perception, blob.perception, `blob ${b}`);
      assert.equal(activities[b].interest, blob.interest, `blob ${b}`);
      assert.equal(activities[b].mood, moodFor(blob.perception, blob.interest), `blob ${b}`);
    }
  });

  test("uses the completed round's scores once a round is done", () => {
    const activities = cityActivities(GOLDEN, 1, 1);
    const completed = GOLDEN.rounds[0];
    for (let b = 0; b < COUNT; b++) {
      assert.equal(activities[b].perception, completed.perception[b], `blob ${b}`);
      assert.equal(activities[b].interest, completed.interest[b], `blob ${b}`);
      assert.equal(
        activities[b].mood,
        moodFor(completed.perception[b], completed.interest[b]),
        `blob ${b}`,
      );
    }
  });

  test("reports a later round's roles while keeping the completed scores", () => {
    const round = 1;
    const activities = cityActivities(GOLDEN, round, 1);
    const { posters, speakers, listeners } = roles(GOLDEN, round);
    for (let b = 0; b < COUNT; b++) {
      const activity = activities[b];
      if (posters.has(b)) assert.equal(activity.state, "posting", `blob ${b}`);
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
});

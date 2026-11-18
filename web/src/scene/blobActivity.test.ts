/// <reference types="node" />
// Run: node --test web/src/scene/blobActivity.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MOOD_FIRST_ID,
  beatActivities,
  scenarioFirstId,
  staticActivities,
} from "./blobActivity.ts";
import { MOODS } from "./blobMood.ts";
import { SCENARIOS } from "./blobScenarios.ts";
import { shapesFixture } from "./shapesFixture.ts";

const scenarioIndex = (title: string) => SCENARIOS.findIndex((s) => s.title === title);
const beatsOf = (title: string) => {
  const i = scenarioIndex(title);
  return SCENARIOS[i].beats.map((_, beat) =>
    beatActivities(SCENARIOS[i], beat, scenarioFirstId(i)),
  );
};

describe("scenarioFirstId", () => {
  test("gives each scenario ten ids from 200", () => {
    assert.deepEqual(
      SCENARIOS.map((_, i) => scenarioFirstId(i)),
      [200, 210, 220, 230],
    );
  });
});

describe("beatActivities", () => {
  test("reports every actor in every beat, with the beat's mood", () => {
    SCENARIOS.forEach((scenario, i) => {
      const firstId = scenarioFirstId(i);
      scenario.beats.forEach((beat, b) => {
        const activities = beatActivities(scenario, b, firstId);
        assert.deepEqual(
          Object.keys(activities).map(Number),
          scenario.actors.map((_, j) => firstId + j),
        );
        beat.actors.forEach((part, j) => assert.equal(activities[firstId + j].mood, part.mood));
      });
    });
  });

  test("never names a partner who is not in the scenario, or the actor itself", () => {
    SCENARIOS.forEach((scenario, i) => {
      const firstId = scenarioFirstId(i);
      const ids = scenario.actors.map((_, j) => firstId + j);
      scenario.beats.forEach((_, b) => {
        for (const [id, { partnerId }] of Object.entries(beatActivities(scenario, b, firstId))) {
          if (partnerId === undefined) continue;
          assert.ok(ids.includes(partnerId), `${scenario.title} beat ${b}`);
          assert.notEqual(partnerId, Number(id));
        }
      });
    });
  });

  test("shows whoever speaks talking and the other listening to them", () => {
    const [first, , third, fourth] = beatsOf("Talking");
    assert.deepEqual(first[200], { state: "talking", mood: "smile", partnerId: 201 });
    assert.deepEqual(first[201], { state: "listening", mood: "flat", partnerId: 200 });
    assert.equal(third[200].state, "talking");
    assert.equal(third[201].state, "listening");
    // Nobody speaks, so nobody listens.
    assert.equal(fourth[200].state, "idle");
    assert.equal(fourth[201].state, "idle");
  });

  test("has both talk in an argument's last exchange, and each swap with the other", () => {
    const beats = beatsOf("Arguing");
    // Beat 1: the second answers the first, who stopped.
    assert.deepEqual(beats[1][211], { state: "talking", mood: "frown", partnerId: 210 });
    assert.equal(beats[1][210].state, "listening");
    // Beat 4: both talk, each to the other.
    assert.deepEqual(beats[4][210], { state: "talking", mood: "angry", partnerId: 211 });
    assert.deepEqual(beats[4][211], { state: "talking", mood: "angry", partnerId: 210 });
    // Beat 5: both slump quietly.
    assert.equal(beats[5][210].state, "idle");
  });

  test("posts only while the phone is out, with no partner", () => {
    const beats = beatsOf("Posting");
    SCENARIOS[scenarioIndex("Posting")].beats.forEach((beat, b) => {
      const activity = beats[b][220];
      assert.equal(activity.state, beat.actors[0].pose === "phone" ? "posting" : "idle");
      assert.equal(activity.partnerId, undefined);
    });
    assert.ok(beats.some((b) => b[220].state === "posting"));
  });

  test("walks only in beats that move the actor away from where the last beat left it", () => {
    const beats = beatsOf("Walking");
    // Pause, walk right, pause, walk left.
    assert.deepEqual(
      beats.map((b) => b[230].state),
      ["idle", "walking", "idle", "walking"],
    );
  });

  test("leaves out a partner key rather than setting it to undefined", () => {
    const [first] = beatsOf("Walking");
    assert.ok(!("partnerId" in first[230]));
  });
});

describe("staticActivities", () => {
  test("covers the shape grid 1..18 and the mood samples 100+, all idle", () => {
    const activities = staticActivities();
    assert.deepEqual(Object.keys(activities).map(Number), [
      ...shapesFixture.map((b) => b.id),
      ...MOODS.map((_, i) => MOOD_FIRST_ID + i),
    ]);
    for (const activity of Object.values(activities)) assert.equal(activity.state, "idle");
  });

  test("gives each mood sample its own mood, and the grid the default smile", () => {
    const activities = staticActivities();
    MOODS.forEach((mood, i) => assert.equal(activities[MOOD_FIRST_ID + i].mood, mood));
    for (const { id } of shapesFixture) assert.equal(activities[id].mood, "smile");
  });
});

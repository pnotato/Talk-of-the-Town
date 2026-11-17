/// <reference types="node" />
// Run: node --test web/src/scene/blobScenarios.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SCENARIOS, scenarioHalfWidth } from "./blobScenarios.ts";

const byTitle = (title: string) => SCENARIOS.find((s) => s.title === title)!;
const everyActorBeat = (title: string) => byTitle(title).beats.flatMap((b) => b.actors);

describe("SCENARIOS", () => {
  test("give every beat a duration and a part for every actor, in loops of at most 12 seconds", () => {
    for (const { title, actors, beats } of SCENARIOS) {
      assert.ok(beats.length >= 2, title);
      for (const beat of beats) {
        assert.ok(beat.seconds > 0, title);
        assert.equal(beat.actors.length, actors.length, title);
      }
      const loop = beats.reduce((sum, b) => sum + b.seconds, 0);
      assert.ok(loop <= 12, `${title} loops every ${loop} s`);
    }
  });

  test("show talking with a reaction, an argument that turns angry, posting and walking", () => {
    assert.ok(everyActorBeat("Talking").some((a) => a.talking));
    assert.ok(new Set(everyActorBeat("Talking").map((a) => a.mood)).size >= 4, "reactions");
    assert.ok(everyActorBeat("Arguing").some((a) => a.mood === "angry" && a.talking));
    assert.ok(everyActorBeat("Posting").some((a) => a.pose === "phone"));
    const spots = new Set(everyActorBeat("Walking").map((a) => a.x));
    assert.ok(spots.size >= 2, "walks between spots");
  });

  test("keep every scenario within 1.2 units of its centre, so neighbours don't collide", () => {
    for (const scenario of SCENARIOS) assert.ok(scenarioHalfWidth(scenario) <= 1.2, scenario.title);
  });
});

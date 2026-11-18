/// <reference types="node" />
// Run: node --experimental-strip-types --test web/src/inspector/*.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MOODS, moodFor } from "../scene/blobMood.ts";
import { SCENARIOS } from "../scene/blobScenarios.ts";
import { ageGroup } from "../scene/blobSize.ts";
import { shapesFixture } from "../scene/shapesFixture.ts";
import {
  getProfile,
  PROFILE_NOTE,
  PROFILE_ORDER,
  PROFILE_SOURCE,
  PROFILES,
} from "./blobProfiles.ts";

const sceneIds = [
  ...shapesFixture.map((b) => b.id),
  ...MOODS.map((_, i) => 100 + i),
  ...SCENARIOS.flatMap((s, i) => s.actors.map((_, j) => 200 + 10 * i + j)),
];

describe("PROFILES", () => {
  test("cover exactly the blobs the scene draws, in a stable order", () => {
    assert.deepEqual(
      [...PROFILE_ORDER].sort((a, b) => a - b),
      [...sceneIds].sort((a, b) => a - b),
    );
    assert.equal(new Set(PROFILE_ORDER).size, PROFILE_ORDER.length);
    for (const id of sceneIds) assert.ok(getProfile(id), `blob ${id}`);
    assert.equal(getProfile(999), undefined);
  });

  test("take shape and age from the scene's own data", () => {
    for (const { id, shape, age } of shapesFixture) {
      assert.equal(getProfile(id)?.shape, shape);
      assert.equal(getProfile(id)?.age, age);
    }
    SCENARIOS.forEach((scenario, i) =>
      scenario.actors.forEach((actor, j) => {
        const profile = getProfile(200 + 10 * i + j)!;
        assert.equal(profile.shape, actor.shape);
        assert.equal(profile.age, actor.age);
      }),
    );
  });

  test("have unique fictional names, valid scores and 1–3 traits with at most one per category", () => {
    const names = PROFILES.map((p) => p.name);
    assert.equal(new Set(names).size, names.length);
    const categories = [
      ["skeptic", "gullible"],
      ["quiet", "chatty"],
      ["unconvincing", "charismatic"],
    ];
    for (const p of PROFILES) {
      assert.ok(p.name.trim().length > 0);
      for (const score of [p.perception, p.interest]) assert.ok(score >= 0 && score <= 100, p.name);
      assert.ok(p.traits.length >= 1 && p.traits.length <= 3, p.name);
      assert.equal(new Set(p.traits).size, p.traits.length, p.name);
      for (const pair of categories) {
        assert.ok(p.traits.filter((t) => pair.includes(t)).length <= 1, p.name);
      }
      assert.equal(p.mood, moodFor(p.perception, p.interest), p.name);
    }
  });

  test("give each shape one leader, who is charismatic", () => {
    const leaders = PROFILES.filter((p) => p.traits.includes("leader"));
    assert.deepEqual(leaders.map((p) => p.shape).sort(), [
      "capsule",
      "circle",
      "square",
      "star",
      "tear",
      "triangle",
    ]);
    for (const p of leaders) assert.ok(p.traits.includes("charismatic"), p.name);
  });

  test("give every mood-row and scene blob scores whose resting face is the one the scene starts it with", () => {
    MOODS.forEach((mood, i) => assert.equal(getProfile(100 + i)?.mood, mood));
    SCENARIOS.forEach((scenario, i) =>
      scenario.actors.forEach((_, j) =>
        assert.equal(getProfile(200 + 10 * i + j)?.mood, scenario.beats[0].actors[j].mood),
      ),
    );
  });
});

describe("families", () => {
  test("are authored, mutual and within one shape, with an adult parent of a child", () => {
    let families = 0;
    for (const p of PROFILES) {
      for (const childId of p.childIds) {
        const child = getProfile(childId)!;
        assert.deepEqual(child.parentIds, [p.id]);
        assert.equal(child.shape, p.shape);
        assert.equal(ageGroup(p.age), "adult");
        assert.equal(ageGroup(child.age), "child");
        assert.ok(p.traits.includes("family-oriented") && child.traits.includes("family-oriented"));
        families++;
      }
      for (const parentId of p.parentIds) assert.ok(getProfile(parentId)!.childIds.includes(p.id));
    }
    assert.equal(families, 6);
  });

  test("are not guessed for blobs that have none: elders, the mood row and scenes", () => {
    for (const p of PROFILES) {
      if (ageGroup(p.age) === "elder" || p.group !== "shapes") {
        assert.deepEqual([p.parentIds, p.childIds], [[], []], p.name);
      }
    }
  });
});

describe("scores", () => {
  test("are the authored demo values, whatever mood the scene shows", () => {
    const pairs = (ids: number[]) =>
      ids.map((id) => [getProfile(id)!.perception, getProfile(id)!.interest]);
    assert.deepEqual(pairs([1, 2, 18]), [
      [66, 28],
      [82, 64],
      [90, 30],
    ]);
    // Angry (106) and smiling (100) mood-row blobs keep their own, different pairs.
    assert.deepEqual(pairs([100, 106]), [
      [80, 50],
      [10, 40],
    ]);
    // A scene actor's pair is fixed even though its scene plays moods other than its first.
    assert.deepEqual(pairs([210]), [[44, 40]]);
  });

  test("are never derived or swapped in from a mood: the module offers no such helper", async () => {
    const profiles = await import("./blobProfiles.ts");
    assert.ok(!("scoresFor" in profiles));
    assert.ok(!("MOOD_SAMPLE_SCORES" in profiles));
  });
});

test("demo data is labelled", () => {
  assert.equal(PROFILE_SOURCE, "Sandbox profile");
  assert.match(PROFILE_NOTE, /no live run/);
});

/// <reference types="node" />
// Run: node --experimental-strip-types --test web/src/inspector/*.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getProfile, PROFILES, type Trait } from "./blobProfiles.ts";
import { groupTraits, personalityTags, specialTags } from "./traitGroups.ts";

const none = { parentIds: [], childIds: [] };
const kinds = (tags: { kind: string }[]) => tags.map((t) => t.kind);

describe("specialTags", () => {
  test("take leader, recluse and family-oriented from the traits, in a fixed order", () => {
    const traits: Trait[] = ["recluse", "family-oriented", "leader", "skeptic"];
    assert.deepEqual(kinds(specialTags({ traits, ...none })), [
      "leader",
      "recluse",
      "family-oriented",
    ]);
  });

  test("take parent and child from authored relationship ids, after the trait tags", () => {
    const both = specialTags({ traits: ["family-oriented"], parentIds: [1], childIds: [3] });
    assert.deepEqual(kinds(both), ["family-oriented", "parent", "child"]);
    assert.deepEqual(kinds(specialTags({ traits: [], parentIds: [], childIds: [4] })), ["parent"]);
    assert.deepEqual(kinds(specialTags({ traits: [], parentIds: [9], childIds: [] })), ["child"]);
  });

  test("never infer a role from age, or a role from the family-oriented trait alone", () => {
    // Pip is 8 and Walt is 75, but only the authored links make a child or a parent.
    assert.deepEqual(kinds(specialTags(getProfile(1)!)), ["family-oriented", "child"]);
    assert.deepEqual(kinds(specialTags(getProfile(3)!)), []);
    const lonely = { traits: ["family-oriented"] satisfies Trait[], ...none };
    assert.deepEqual(kinds(specialTags(lonely)), ["family-oriented"]);
  });

  test("are empty, not an error, when there are none", () => {
    assert.deepEqual(specialTags({ traits: ["skeptic", "quiet"], ...none }), []);
    assert.deepEqual(specialTags({ traits: [], ...none }), []);
  });
});

describe("personalityTags", () => {
  test("keep only the ordinary personality tags, ordered by category", () => {
    const tags = personalityTags({
      traits: ["charismatic", "leader", "chatty", "family-oriented", "skeptic", "recluse"],
    });
    assert.deepEqual(
      tags.map((t) => [t.trait, t.category]),
      [
        ["skeptic", "credulity"],
        ["chatty", "socialness"],
        ["charismatic", "persuasiveness"],
      ],
    );
  });

  test("drop duplicates and are empty when a blob has no personality tags", () => {
    assert.deepEqual(
      personalityTags({ traits: ["gullible", "gullible"] }).map((t) => t.trait),
      ["gullible"],
    );
    assert.deepEqual(personalityTags({ traits: ["leader", "recluse"] }), []);
    assert.deepEqual(personalityTags({ traits: [] }), []);
  });
});

describe("groupTraits", () => {
  test("put every authored trait of every sandbox blob in exactly one group", () => {
    for (const p of PROFILES) {
      const { special, personality } = groupTraits(p);
      const shown = [
        ...special.map((t) => t.kind).filter((k) => k !== "parent" && k !== "child"),
        ...personality.map((t) => t.trait),
      ];
      assert.deepEqual([...shown].sort(), [...p.traits].sort(), p.name);
    }
  });

  test("give every tag a plain label and meaning", () => {
    for (const p of PROFILES) {
      const { special, personality } = groupTraits(p);
      for (const tag of special) assert.ok(tag.label.length > 0 && tag.meaning.length > 0);
      for (const tag of personality) assert.ok(tag.meaning.length > 0);
    }
  });
});

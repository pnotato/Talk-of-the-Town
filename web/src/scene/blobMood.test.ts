/// <reference types="node" />
// Run: node --test web/src/scene/blobMood.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Emotions } from "../generated/types.ts";
import {
  EMOTION_MOOD,
  EMOTIONS,
  MOOD_COLOR,
  MOOD_FACE,
  MOOD_MEANING,
  MOODS,
  type Mood,
  moodFor,
  moodForEmotions,
} from "./blobMood.ts";

const CALM: Emotions = { calm: 100, joy: 0, trust: 0, surprise: 0, fear: 0, sadness: 0, anger: 0 };

describe("moodForEmotions", () => {
  test("wears the biggest share", () => {
    assert.equal(moodForEmotions(CALM), "flat");
    assert.equal(moodForEmotions({ ...CALM, calm: 30, anger: 40, sadness: 30 }), "angry");
    assert.equal(moodForEmotions({ ...CALM, calm: 20, surprise: 35, joy: 25, fear: 20 }), "o");
    assert.equal(moodForEmotions({ ...CALM, calm: 40, trust: 35, joy: 25 }), "flat");
  });

  test("lets calm win ties, then the emotion earlier in EMOTIONS", () => {
    assert.equal(moodForEmotions({ ...CALM, calm: 50, anger: 50 }), "flat");
    assert.equal(moodForEmotions({ ...CALM, calm: 0, joy: 50, anger: 50 }), "smile");
  });

  test("gives each emotion its own mood, in the moods' order", () => {
    assert.deepEqual(
      EMOTIONS.map((e) => EMOTION_MOOD[e]),
      [...MOODS],
    );
    for (const emotion of EMOTIONS) {
      assert.equal(moodForEmotions({ ...CALM, calm: 0, [emotion]: 100 }), EMOTION_MOOD[emotion]);
    }
  });

  test("covers every emotion the sim logs", () => {
    assert.deepEqual([...EMOTIONS].sort(), Object.keys(CALM).sort());
  });
});

describe("moodFor", () => {
  test("picks the band from perception and the mood within it from interest, at every edge", () => {
    const cases: [perception: number, interest: number, mood: Mood][] = [
      [100, 0, "smile"],
      [62, 50, "smile"],
      [61, 50, "flat"],
      [61, 14, "sleepy"],
      [61, 15, "flat"],
      [61, 69, "flat"],
      [61, 70, "o"],
      [38, 50, "flat"],
      [37, 49, "frown"],
      [37, 50, "worried"],
      [20, 0, "frown"],
      [20, 100, "worried"],
      [19, 100, "angry"],
      [0, 0, "angry"],
    ];
    for (const [perception, interest, mood] of cases) {
      assert.equal(
        moodFor(perception, interest),
        mood,
        `perception ${perception}, interest ${interest}`,
      );
    }
  });

  test("can reach every mood", () => {
    const seen = new Set<Mood>();
    for (let p = 0; p <= 100; p++) for (let i = 0; i <= 100; i++) seen.add(moodFor(p, i));
    assert.deepEqual([...seen].sort(), [...MOODS].sort());
  });
});

describe("mood looks", () => {
  test("give every mood its own face, so colour is never the only cue", () => {
    const faces = MOODS.map((m) => JSON.stringify(MOOD_FACE[m]));
    assert.equal(new Set(faces).size, MOODS.length);
  });

  test("give every mood its own colour and a meaning", () => {
    assert.equal(new Set(MOODS.map((m) => MOOD_COLOR[m])).size, MOODS.length);
    for (const m of MOODS) {
      assert.match(MOOD_COLOR[m], /^#[0-9a-f]{6}$/);
      assert.ok(MOOD_MEANING[m].length > 0);
    }
  });
});

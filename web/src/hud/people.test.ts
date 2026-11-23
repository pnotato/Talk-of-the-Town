/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Mood } from "../scene/blobMood.ts";
import { filterPeople, moodMix, type PersonFields } from "./people.ts";

const PEOPLE: (PersonFields & { mood: Mood })[] = [
  { id: 1, name: "Opal Oysterbed", shape: "tear", age: 50, traits: ["gullible"], mood: "smile" },
  { id: 2, name: "Bob Pickle", shape: "star", age: 20, traits: ["skeptic"], mood: "frown" },
  { id: 3, name: "Zoë Zucchini", shape: "circle", age: 8, traits: [], mood: "smile" },
  { id: 4, name: "Walter Wigglesworth", shape: "triangle", age: 80, traits: [], mood: "angry" },
];
const moodOf = (id: number) => PEOPLE.find((p) => p.id === id)?.mood ?? "flat";

describe("moodMix", () => {
  test("counts each mood, happiest first, and leaves out moods nobody has", () => {
    assert.deepEqual(moodMix([1, 2, 3, 4], moodOf), [
      { mood: "smile", count: 2 },
      { mood: "frown", count: 1 },
      { mood: "angry", count: 1 },
    ]);
    assert.deepEqual(moodMix([], moodOf), []);
  });
});

describe("filterPeople", () => {
  const ids = (list: PersonFields[]) => list.map((p) => p.id);

  test("an empty query and no mood keeps everyone, in order", () => {
    assert.deepEqual(ids(filterPeople(PEOPLE, "  ", null, moodOf)), [1, 2, 3, 4]);
  });

  test("matches any part of a name, ignoring case and accents", () => {
    assert.deepEqual(ids(filterPeople(PEOPLE, "pick", null, moodOf)), [2]);
    assert.deepEqual(ids(filterPeople(PEOPLE, "ZOE", null, moodOf)), [3]);
  });

  test("matches a shape, an age group or a trait by its start", () => {
    assert.deepEqual(ids(filterPeople(PEOPLE, "star", null, moodOf)), [2]);
    assert.deepEqual(ids(filterPeople(PEOPLE, "elder", null, moodOf)), [4]);
    assert.deepEqual(ids(filterPeople(PEOPLE, "child", null, moodOf)), [3]);
    assert.deepEqual(ids(filterPeople(PEOPLE, "skep", null, moodOf)), [2]);
  });

  test("every word has to match", () => {
    assert.deepEqual(ids(filterPeople(PEOPLE, "o adult", null, moodOf)), [1, 2]);
  });

  test("a mood narrows the list, with or without a query", () => {
    assert.deepEqual(ids(filterPeople(PEOPLE, "", "smile", moodOf)), [1, 3]);
    assert.deepEqual(ids(filterPeople(PEOPLE, "opal", "smile", moodOf)), [1]);
    assert.deepEqual(ids(filterPeople(PEOPLE, "bob", "smile", moodOf)), []);
  });
});

/// <reference types="node" />
// Run: node --test web/src/inspector/cityProfiles.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { RunLog } from "../generated/types.ts";
import { moodForEmotions } from "../scene/blobMood.ts";
import { CITY_SOURCE, cityCatalog, EMPTY_CITY_CATALOG } from "./cityProfiles.ts";

const GOLDEN = JSON.parse(
  readFileSync(new URL("../../../internal/sim/testdata/golden_run.json", import.meta.url), "utf8"),
) as RunLog;

describe("cityCatalog", () => {
  const catalog = cityCatalog(GOLDEN);

  test("covers every blob in the run, in id order", () => {
    assert.equal(catalog.order.length, GOLDEN.town.blobs.length);
    assert.deepEqual(
      catalog.order,
      GOLDEN.town.blobs.map((blob) => blob.id),
    );
    for (const blob of GOLDEN.town.blobs) assert.ok(catalog.get(blob.id), `blob ${blob.id}`);
    assert.equal(catalog.get(-1), undefined);
    assert.equal(catalog.get(GOLDEN.town.blobs.length), undefined);
  });

  test("takes each profile's identity and starting scores from the run", () => {
    for (const blob of GOLDEN.town.blobs) {
      const profile = catalog.get(blob.id)!;
      assert.equal(profile.name, blob.name);
      assert.equal(profile.shape, blob.shape);
      assert.equal(profile.age, blob.age);
      assert.deepEqual(profile.traits, blob.traits);
      assert.equal(profile.perception, blob.perception);
      assert.equal(profile.interest, blob.interest);
      assert.deepEqual(profile.emotions, blob.emotions);
      assert.equal(profile.mood, moodForEmotions(blob.emotions));
      assert.equal(profile.group, "city");
    }
  });

  test("takes family links from the run's families", () => {
    const parents = new Map<number, number[]>();
    const children = new Map<number, number[]>();
    for (const family of GOLDEN.town.families) {
      for (const parent of family.parents) {
        for (const child of family.children) {
          parents.set(child, [...(parents.get(child) ?? []), parent]);
          children.set(parent, [...(children.get(parent) ?? []), child]);
        }
      }
    }
    for (const blob of GOLDEN.town.blobs) {
      const profile = catalog.get(blob.id)!;
      assert.deepEqual(profile.parentIds, parents.get(blob.id) ?? [], profile.name);
      assert.deepEqual(profile.childIds, children.get(blob.id) ?? [], profile.name);
    }
  });

  test("puts everyone in one directory section and labels the data as simulated", () => {
    assert.equal(catalog.groups.length, 1);
    const [group] = catalog.groups;
    assert.equal(group.key, "city");
    assert.equal(group.profiles.length, GOLDEN.town.blobs.length);
    assert.equal(group.showPlace, undefined);
    assert.equal(catalog.source, CITY_SOURCE);
    assert.match(catalog.description, /simulated/i);
    assert.match(catalog.subtitle, /city/i);
  });

  test("has a safe empty catalog for before the run loads", () => {
    assert.deepEqual(EMPTY_CITY_CATALOG.order, []);
    assert.deepEqual(EMPTY_CITY_CATALOG.groups, []);
    assert.equal(EMPTY_CITY_CATALOG.get(0), undefined);
  });
});

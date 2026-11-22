/// <reference types="node" />
// Run: node --experimental-strip-types --test web/src/inspector/*.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FOCUS_INSET_TOP, focusInset, focusInsetTop, sameInset } from "./focusInset.ts";

describe("focusInset", () => {
  test("measures from the bottom of the parent up to the top of the panel above the bar", () => {
    // A 900px page; the bar's top is at 838 and a 270px card sits above it with an 8px gap.
    assert.deepEqual(focusInset(900, 838, 270, 8), { top: FOCUS_INSET_TOP, bottom: 900 - 560 });
  });

  test("shrinks the top clearance on short stages, but never below 16px", () => {
    assert.equal(focusInsetTop(900), FOCUS_INSET_TOP);
    assert.equal(focusInsetTop(307), 37);
    assert.equal(focusInsetTop(254), 30);
    assert.equal(focusInsetTop(100), 16);
    assert.equal(focusInsetTop(0), FOCUS_INSET_TOP);
    assert.equal(focusInsetTop(NaN), FOCUS_INSET_TOP);
    assert.deepEqual(focusInset(254, 174, 122, 4, 254), { top: 30, bottom: 206 });
  });

  test("falls back to the bar when there is no card or list", () => {
    assert.deepEqual(focusInset(900, 838, null, 8), { top: FOCUS_INSET_TOP, bottom: 62 });
  });

  test("follows the parent's bottom, so a resized window changes it even if the panel didn't", () => {
    assert.equal(focusInset(900, 838, 270, 8).bottom, focusInset(800, 738, 270, 8).bottom);
    assert.equal(focusInset(900, 838, 270, 8).bottom, 340);
    assert.equal(focusInset(960, 838, 270, 8).bottom, 400);
  });

  test("rounds to whole pixels and never goes negative", () => {
    assert.equal(focusInset(900.4, 838, 270, 8).bottom, 340);
    assert.equal(focusInset(100, 400, null, 8).bottom, 0);
  });
});

test("sameInset compares both edges", () => {
  assert.ok(sameInset({ top: 112, bottom: 300 }, { top: 112, bottom: 300 }));
  assert.ok(!sameInset({ top: 112, bottom: 300 }, { top: 112, bottom: 301 }));
  assert.ok(!sameInset({ top: 112, bottom: 300 }, { top: 100, bottom: 300 }));
});

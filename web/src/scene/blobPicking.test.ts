/// <reference types="node" />
// Run: node --test web/src/scene/blobPicking.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CLICK_SLOP,
  type PointerSample,
  createGestureTracker,
  gestureFor,
  isClick,
  setHover,
} from "./blobPicking.ts";

describe("isClick", () => {
  test("accepts a press and release in the same place, and a little jitter", () => {
    assert.ok(isClick(0));
    assert.ok(isClick(CLICK_SLOP));
  });

  test("rejects the end of an orbit or pan drag", () => {
    assert.ok(!isClick(CLICK_SLOP + 1));
    assert.ok(!isClick(120));
  });
});

describe("setHover", () => {
  const element = () => ({ style: { cursor: "" } });

  test("shows a pointer while anything is hovered, and the default cursor otherwise", () => {
    const el = element();
    setHover(el, "a", true);
    assert.equal(el.style.cursor, "pointer");
    setHover(el, "a", false);
    assert.equal(el.style.cursor, "");
  });

  test("stays a pointer when the pointer slides from one blob to another, in either order", () => {
    const leaveFirst = element();
    setHover(leaveFirst, "a", true);
    setHover(leaveFirst, "a", false);
    setHover(leaveFirst, "b", true);
    assert.equal(leaveFirst.style.cursor, "pointer");

    const enterFirst = element();
    setHover(enterFirst, "a", true);
    setHover(enterFirst, "b", true);
    setHover(enterFirst, "a", false);
    assert.equal(enterFirst.style.cursor, "pointer");
    setHover(enterFirst, "b", false);
    assert.equal(enterFirst.style.cursor, "");
  });

  test("keeps each element's cursor to itself, and ignores leaving twice", () => {
    const [one, two] = [element(), element()];
    setHover(one, "a", true);
    setHover(two, "b", true);
    setHover(one, "a", false);
    setHover(one, "a", false);
    assert.equal(one.style.cursor, "");
    assert.equal(two.style.cursor, "pointer");
  });
});

const pointer = (x: number, y: number, pointerId = 1, isPrimary = true): PointerSample => ({
  pointerId,
  clientX: x,
  clientY: y,
  isPrimary,
});

describe("createGestureTracker", () => {
  test("lets a true click through: no travel, or jitter within the slop", () => {
    const still = createGestureTracker();
    still.down(pointer(100, 100));
    still.up(pointer(100, 100));
    assert.ok(still.isClick(0));

    const jitter = createGestureTracker();
    jitter.down(pointer(100, 100));
    jitter.move(pointer(103, 104));
    jitter.up(pointer(102, 103));
    assert.ok(jitter.isClick(Math.hypot(2, 3)));
    assert.ok(!jitter.dragged);
  });

  test("rejects an orbit drag that ends where it began", () => {
    const tracker = createGestureTracker();
    tracker.down(pointer(100, 100));
    tracker.move(pointer(160, 100));
    tracker.move(pointer(101, 100));
    tracker.up(pointer(100, 100));
    // The click event only sees the end: right back at the start.
    assert.ok(isClick(0));
    assert.ok(!tracker.isClick(0));
    assert.ok(tracker.dragged);
  });

  test("keeps rejecting after release, until the next gesture starts", () => {
    const tracker = createGestureTracker();
    tracker.down(pointer(0, 0));
    tracker.move(pointer(50, 0));
    tracker.up(pointer(0, 0));
    assert.ok(!tracker.isClick(0));
    tracker.down(pointer(0, 0));
    tracker.up(pointer(0, 0));
    assert.ok(tracker.isClick(0), "the next press is a fresh gesture");
  });

  test("still checks the click's own distance", () => {
    const tracker = createGestureTracker();
    tracker.down(pointer(0, 0));
    tracker.up(pointer(0, 0));
    assert.ok(!tracker.isClick(CLICK_SLOP + 1));
  });

  test("treats a second finger as a pinch or two-finger pan, even if both stay still", () => {
    const tracker = createGestureTracker();
    tracker.down(pointer(10, 10, 1, true));
    tracker.down(pointer(50, 50, 2, false));
    tracker.up(pointer(50, 50, 2, false));
    tracker.up(pointer(10, 10, 1, true));
    assert.ok(!tracker.isClick(0));
  });

  test("tracks each pointer from its own start, and ignores pointers that never went down", () => {
    const tracker = createGestureTracker();
    tracker.move(pointer(500, 500, 9));
    tracker.down(pointer(10, 10, 1, true));
    tracker.move(pointer(500, 500, 9));
    tracker.move(pointer(12, 12, 1, true));
    tracker.up(pointer(12, 12, 1, true));
    assert.ok(tracker.isClick(0));
  });

  test("never counts a cancelled gesture as a click", () => {
    const tracker = createGestureTracker();
    tracker.down(pointer(10, 10));
    tracker.cancel(pointer(10, 10));
    assert.ok(!tracker.isClick(0));
    // And the cancel cleans up: the next press is clean.
    tracker.down(pointer(10, 10));
    tracker.up(pointer(10, 10));
    assert.ok(tracker.isClick(0));
  });

  test("recovers when a release was never seen", () => {
    const tracker = createGestureTracker();
    tracker.down(pointer(10, 10));
    tracker.move(pointer(90, 10));
    // pointerup lost, e.g. released outside the window.
    tracker.down(pointer(10, 10));
    tracker.up(pointer(10, 10));
    assert.ok(tracker.isClick(0));
  });
});

describe("gestureFor", () => {
  const fire = (target: EventTarget, type: string, sample: PointerSample) =>
    target.dispatchEvent(Object.assign(new Event(type), sample));

  test("feeds one shared tracker from the canvas's pointer events", () => {
    const canvas = new EventTarget();
    const tracker = gestureFor(canvas);
    assert.equal(gestureFor(canvas), tracker);
    assert.notEqual(gestureFor(new EventTarget()), tracker);

    fire(canvas, "pointerdown", pointer(100, 100));
    fire(canvas, "pointermove", pointer(180, 100));
    fire(canvas, "pointermove", pointer(100, 100));
    fire(canvas, "pointerup", pointer(100, 100));
    assert.ok(!tracker.isClick(0), "an away-and-back drag");

    fire(canvas, "pointerdown", pointer(100, 100));
    fire(canvas, "pointerup", pointer(100, 100));
    assert.ok(tracker.isClick(0), "a true click");

    fire(canvas, "pointerdown", pointer(100, 100));
    fire(canvas, "pointercancel", pointer(100, 100));
    assert.ok(!tracker.isClick(0), "a cancelled gesture");
  });
});

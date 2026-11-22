/// <reference types="node" />
// Run: node --test web/src/scene/mapKeyboard.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Vector3 } from "three";
import {
  isMovementKey,
  isTextEntry,
  KEY_PAN_VIEWS_PER_SECOND,
  keyboardPanStep,
  type PanIntent,
  panIntent,
} from "./mapKeyboard.ts";

const held = (...codes: string[]) => new Set(codes);

function fresh() {
  const intent: PanIntent = { forward: 0, right: 0 };
  const out = new Vector3();
  const scratch = { forward: new Vector3(), right: new Vector3() };
  return { intent, out, scratch };
}

function step(keys: string[], camera: Vector3, target: Vector3, seconds = 1, fov = 30) {
  const { intent, out, scratch } = fresh();
  panIntent(held(...keys), intent);
  const moved = keyboardPanStep(intent, camera, target, fov, seconds, out, scratch);
  return { moved, out };
}

const close = (a: number, b: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} should be close to ${b}`);

describe("isMovementKey", () => {
  test("recognises the four movement keys and nothing else", () => {
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD"])
      assert.equal(isMovementKey(code), true, code);
    for (const code of ["KeyQ", "KeyE", "ArrowUp", "ArrowLeft", "Space", "toString", ""]) {
      assert.equal(isMovementKey(code), false, code);
    }
  });
});

describe("panIntent", () => {
  test("W and S ask to move forward and back", () => {
    const { intent } = fresh();
    assert.equal(panIntent(held("KeyW"), intent), true);
    assert.equal(intent.forward, 1);
    assert.equal(intent.right, 0);

    assert.equal(panIntent(held("KeyS"), intent), true);
    assert.equal(intent.forward, -1);
    assert.equal(intent.right, 0);
  });

  test("A and D ask to move left and right", () => {
    const { intent } = fresh();
    assert.equal(panIntent(held("KeyA"), intent), true);
    assert.deepEqual(intent, { forward: 0, right: -1 });

    assert.equal(panIntent(held("KeyD"), intent), true);
    assert.deepEqual(intent, { forward: 0, right: 1 });
  });

  test("a diagonal is normalised, so it moves no faster than a straight line", () => {
    const { intent } = fresh();
    assert.equal(panIntent(held("KeyW", "KeyD"), intent), true);
    close(Math.hypot(intent.forward, intent.right), 1);
    close(intent.forward, Math.SQRT1_2);
    close(intent.right, Math.SQRT1_2);
  });

  test("opposite keys cancel, and unknown or no keys are still", () => {
    const { intent } = fresh();
    assert.equal(panIntent(held("KeyW", "KeyS"), intent), false);
    assert.deepEqual(intent, { forward: 0, right: 0 });
    assert.equal(panIntent(held("KeyW", "KeyA", "KeyS", "KeyD"), intent), false);
    assert.equal(panIntent(held("KeyQ"), intent), false);
    assert.equal(panIntent(held(), intent), false);
  });
});

describe("keyboardPanStep", () => {
  // Looking north and down: the ground ahead is -z, and the camera's right is +x.
  const camera = new Vector3(0, 10, 10);
  const target = new Vector3(0, 0, 0);

  test("W moves along the ground toward where the camera looks", () => {
    const { moved, out } = step(["KeyW"], camera, target);
    assert.equal(moved, true);
    assert.ok(out.z < 0, `z ${out.z}`);
    close(out.x, 0);
    close(out.y, 0);
  });

  test("D moves to the camera's right, at the same speed as W", () => {
    const { out: forward } = step(["KeyW"], camera, target);
    const { out: right } = step(["KeyD"], camera, target);
    assert.ok(right.x > 0, `x ${right.x}`);
    close(right.z, 0);
    close(right.y, 0);
    close(right.length(), forward.length());
  });

  test("the step takes the share of the view the key rate asks for", () => {
    const { out } = step(["KeyW"], camera, target, 1);
    const distance = camera.distanceTo(target);
    const viewHeight = 2 * distance * Math.tan(Math.PI / 12); // half of 30 degrees
    close(out.length(), viewHeight * KEY_PAN_VIEWS_PER_SECOND, 1e-9);
  });

  test("the step scales with time and with zoom", () => {
    const one = step(["KeyW"], camera, target, 1).out.length();
    const half = step(["KeyW"], camera, target, 0.5).out.length();
    const further = step(["KeyW"], camera.clone().multiplyScalar(2), target, 1).out.length();
    close(half, one / 2);
    close(further, one * 2);
  });

  test("a diagonal moves as far as a straight line", () => {
    const straight = step(["KeyW"], camera, target).out.length();
    const diagonal = step(["KeyW", "KeyD"], camera, target).out.length();
    close(diagonal, straight);
  });

  test("looking straight down has no ground direction, so nothing moves", () => {
    const { moved, out } = step(["KeyW"], new Vector3(0, 10, 0), target);
    assert.equal(moved, false);
    assert.equal(out.length(), 0);
  });

  test("nothing held means no step, and the inputs are left alone", () => {
    const { intent, out, scratch } = fresh();
    assert.equal(keyboardPanStep(intent, camera, target, 30, 1, out, scratch), false);
    const cameraBefore = camera.clone();
    const targetBefore = target.clone();
    step(["KeyW"], camera, target);
    assert.deepEqual(camera, cameraBefore);
    assert.deepEqual(target, targetBefore);
  });
});

describe("isTextEntry", () => {
  const target = (tagName: string, isContentEditable = false) =>
    ({ tagName, isContentEditable }) as unknown as EventTarget;

  test("fields and editable content take the keys; ordinary elements do not", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT", "input", "textarea"]) {
      assert.equal(isTextEntry(target(tag)), true, tag);
    }
    assert.equal(isTextEntry(target("DIV", true)), true);
    assert.equal(isTextEntry(target("DIV")), false);
    assert.equal(isTextEntry(target("BUTTON")), false);
  });

  test("no target is not a text entry", () => {
    assert.equal(isTextEntry(null), false);
  });
});

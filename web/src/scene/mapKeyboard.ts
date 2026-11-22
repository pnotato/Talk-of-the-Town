import { MathUtils, Vector3 } from "three";

// Moving the map camera with W, A, S and D: which way held keys ask for, and how far to
// glide over the ground each frame. Plain numbers and scratch vectors created once and updated
// in place, so a frame allocates nothing.

/**
 * Share of the view's height the keys cross per second. The view's height grows with the
 * camera's distance, so the keys cover the same amount of the screen at any zoom.
 */
export const KEY_PAN_VIEWS_PER_SECOND = 0.6;

// A key's share of a move in the camera's own frame: forward, then right.
const MOVEMENT: ReadonlyMap<string, readonly [number, number]> = new Map([
  ["KeyW", [1, 0]],
  ["KeyS", [-1, 0]],
  ["KeyA", [0, -1]],
  ["KeyD", [0, 1]],
]);

const WORLD_UP = new Vector3(0, 1, 0);

/** How far forward and right the keys ask the camera to move, each in -1 to 1. */
export interface PanIntent {
  forward: number;
  right: number;
}

/** Scratch vectors for `keyboardPanStep`, created once. */
export interface PanScratch {
  forward: Vector3;
  right: Vector3;
}

export function isMovementKey(code: string): boolean {
  return MOVEMENT.has(code);
}

/**
 * Reads the held movement keys into `out`, normalised so a diagonal moves no faster than a
 * straight line. Returns false, with `out` zeroed, when nothing is held (or opposite keys cancel).
 */
export function panIntent(keys: ReadonlySet<string>, out: PanIntent): boolean {
  let forward = 0;
  let right = 0;
  for (const code of keys) {
    const direction = MOVEMENT.get(code);
    if (!direction) continue;
    forward += direction[0];
    right += direction[1];
  }
  if (forward === 0 && right === 0) {
    out.forward = 0;
    out.right = 0;
    return false;
  }
  const length = Math.hypot(forward, right);
  out.forward = forward / length;
  out.right = right / length;
  return true;
}

/**
 * The ground-plane step `intent` asks for, given the camera and the point it orbits, in world
 * units. The camera's view direction flattened onto the ground is forward; right is a quarter
 * turn from it. Speed follows the view's height, so the keys cross the same share of the screen
 * at every zoom. Writes into `out`, using `scratch`, and returns whether it moved.
 */
export function keyboardPanStep(
  intent: PanIntent,
  camera: Vector3,
  target: Vector3,
  fovDeg: number,
  seconds: number,
  out: Vector3,
  scratch: PanScratch,
): boolean {
  if (intent.forward === 0 && intent.right === 0) return false;

  const forward = scratch.forward.subVectors(target, camera);
  forward.y = 0;
  const flat = forward.length();
  // Looking straight down: no ground direction to move along, so the keys stay quiet.
  if (flat < 1e-6) return false;
  forward.divideScalar(flat);

  const right = scratch.right.crossVectors(forward, WORLD_UP).normalize();
  const distance = camera.distanceTo(target);
  const viewHeight = 2 * distance * Math.tan(MathUtils.degToRad(fovDeg / 2));
  const step = viewHeight * KEY_PAN_VIEWS_PER_SECOND * seconds;

  out
    .set(0, 0, 0)
    .addScaledVector(forward, intent.forward * step)
    .addScaledVector(right, intent.right * step);
  return true;
}

/**
 * Whether a key event's target is a text entry, so a letter typed into a field never moves the
 * camera. Duck-typed, so it works on plain event targets and in tests without a DOM.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const entry = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof entry.tagName === "string" ? entry.tagName.toUpperCase() : "";
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || entry.isContentEditable === true
  );
}

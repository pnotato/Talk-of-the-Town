import type { Mood } from "./blobMood.ts";

// How a blob moves: a looping idle per mood, poses, a squash-and-stretch hop while walking, and a
// flapping mouth while talking. Pure maths on plain objects that are created once per blob and
// updated in place, so a frame allocates nothing. The pivot is at the feet: rotations and scales
// leave the base on the ground.

export const POSES = [
  "idle",
  "lean",
  "recoil",
  "tremble",
  "shake",
  "bounce",
  "slump",
  "phone",
] as const;

/** What a blob is doing with its body. "phone" is posting to social media. */
export type Pose = (typeof POSES)[number];

/** A body's offset from rest for one frame: lift, rotation (radians) and scale (sz = sx). */
export type Motion = { y: number; rx: number; ry: number; rz: number; sx: number; sy: number };

/** Half-extents of the flat base a body stands on (BASE_EXTENT in blobGeometry.ts). */
export type Base = { x: number; z: number };

export type BlobAnimation = {
  // Set by the blob every frame.
  mood: Mood;
  pose: Pose;
  /** Play the mood's idle loop while not posing or walking. */
  idle: boolean;
  talking: boolean;
  reduceMotion: boolean;
  // Carried between frames.
  /** Forward lean (radians) and lift, eased towards the pose's settled values. */
  lean: number;
  rise: number;
  /** How much the blob is walking, 0..1, and how far through its hop cycle (radians). */
  moving: number;
  stride: number;
};

export function createAnimation(mood: Mood): BlobAnimation {
  return {
    mood,
    pose: "idle",
    idle: false,
    talking: false,
    reduceMotion: false,
    lean: 0,
    rise: 0,
    moving: 0,
    stride: 0,
  };
}

export function createMotion(): Motion {
  return { y: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1 };
}

function rest(out: Motion): Motion {
  out.y = out.rx = out.ry = out.rz = 0;
  out.sx = out.sy = 1;
  return out;
}

/** Scales height by `sy` and width and depth by 1/√sy, so the volume stays the same. */
export function squash(out: Motion, sy: number): Motion {
  out.sy *= sy;
  out.sx /= Math.sqrt(sy);
  return out;
}

/** 0 → 1 → 0 over `length` seconds, once every `period` seconds; 0 the rest of the time. */
function burst(t: number, period: number, length: number) {
  const p = ((t % period) + period) % period;
  return p < length ? Math.sin((p / length) * Math.PI) : 0;
}

/** A hop: up in the air, stretched tall at the top and squashed flat on landing. */
function hop(out: Motion, phase: number, height: number, amount: number) {
  const air = Math.abs(Math.sin(phase)); // 0 on the ground, 1 at the top
  out.y += height * air * amount;
  squash(out, 1 + amount * (0.22 * air - 0.12 * (1 - air) ** 4));
}

/** Adds a mood's idle loop at time `t` (seconds). */
function moodIdle(out: Motion, mood: Mood, t: number) {
  switch (mood) {
    case "smile": // happy hops
      hop(out, t * 3, 0.2, 0.7);
      break;
    case "sleepy": // slow breathing and a drowsy sway
      out.sy *= 1 + 0.04 * Math.sin(t * 1.2);
      out.rz += 0.08 * Math.sin(t * 0.6);
      break;
    case "flat": // idly looking left and right
      out.ry += 0.25 * Math.sin(t * 0.8);
      break;
    case "o": {
      // a startled pop every couple of seconds
      const b = burst(t, 2, 0.35);
      out.y += 0.3 * b;
      squash(out, 1 + 0.15 * b);
      break;
    }
    case "frown": // slumped forward, slowly sighing
      out.rx += 0.15 + 0.05 * Math.sin(t * 0.7);
      out.sy *= 0.97 + 0.02 * Math.sin(t * 0.7);
      break;
    case "worried": // a nervous tremble with quick glances around
      out.rz += 0.05 * Math.sin(t * 25);
      out.ry += 0.3 * Math.sin(t * 1.3) * Math.abs(Math.sin(t * 0.5));
      break;
    case "angry": {
      // fuming: puffing up and shaking in bursts
      const b = burst(t, 1.6, 0.6);
      out.rz += 0.12 * b * Math.sin(t * 30);
      out.sx *= 1 + 0.06 * b;
      out.sy *= 1 + 0.06 * b;
      break;
    }
  }
}

/** The lean (radians, forward is +) and lift each pose settles into. */
export const POSE_SETTLE: Record<Pose, { lean: number; rise: number }> = {
  idle: { lean: 0, rise: 0 },
  lean: { lean: 0.12, rise: 0 },
  recoil: { lean: -0.14, rise: 0.05 },
  tremble: { lean: -0.04, rise: 0 },
  shake: { lean: 0.1, rise: 0 },
  bounce: { lean: 0.05, rise: 0 },
  slump: { lean: 0.18, rise: 0 },
  phone: { lean: 0.22, rise: 0 }, // head down, looking at the screen
};

/** Adds a pose's own movement on top of its settled lean. */
function poseWobble(out: Motion, pose: Pose, t: number) {
  switch (pose) {
    case "tremble":
      out.rz += 0.05 * Math.sin(t * 28);
      break;
    case "shake":
      out.rz += 0.06 * Math.sin(t * 32);
      out.y += 0.04 * Math.abs(Math.sin(t * 9));
      break;
    case "bounce":
      out.y += 0.1 * Math.abs(Math.sin(t * 5));
      break;
    case "slump":
      out.sy *= 0.95;
      break;
  }
}

/** `value` eased towards `target` at `rate` per second; reduced motion snaps. */
export function ease(value: number, target: number, rate: number, delta: number, snap: boolean) {
  return snap ? target : target + (value - target) * Math.exp(-rate * delta);
}

/**
 * Advances `anim` by `delta` seconds while the blob walks at `speed` (world units per second), and
 * writes this frame's body motion at time `t` into `out`. Reduced motion gives the rest pose.
 */
export function animate(
  anim: BlobAnimation,
  t: number,
  delta: number,
  speed: number,
  base: Base,
  out: Motion,
): Motion {
  rest(out);
  if (anim.reduceMotion) return out;

  const settle = POSE_SETTLE[anim.pose];
  anim.lean = ease(anim.lean, settle.lean, 8, delta, false);
  anim.rise = ease(anim.rise, settle.rise, 8, delta, false);
  // About four hops a second at full stride.
  anim.moving = ease(anim.moving, Math.min(speed / 1.5, 1), 5, delta, false);
  anim.stride += delta * (2 + 2 * anim.moving) * Math.PI * anim.moving;

  if (anim.idle && anim.pose === "idle" && anim.moving < 0.05) moodIdle(out, anim.mood, t);
  out.rx += anim.lean + 0.12 * anim.moving;
  out.y += anim.rise;
  poseWobble(out, anim.pose, t);
  hop(out, anim.stride, 0.28, anim.moving);

  // Keep the feet planted: tipping about the middle of a flat base would sink its leading edge,
  // so lift the body until that edge touches the ground.
  out.y += out.sx * (base.z * Math.abs(Math.sin(out.rx)) + base.x * Math.abs(Math.sin(out.rz)));
  return out;
}

/** How open the mouth is, 0..1: flapping while talking, shut with reduced motion. */
export function mouthOpen(anim: BlobAnimation, t: number) {
  return anim.talking && !anim.reduceMotion ? Math.abs(Math.sin(t * 13)) : 0;
}

/**
 * A blob's offset into every loop, in seconds, from its id: deterministic, and spread out so
 * neighbours with consecutive ids don't move in lockstep.
 */
export function phaseFor(id: number) {
  return ((id * 0.6180339887) % 1) * 10;
}

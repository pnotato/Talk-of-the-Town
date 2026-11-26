import type { HarbourLayout } from "./layoutHarbour.ts";
import type { Point } from "./mapLayout.ts";

// How the harbour moves: its waves and where they calm, how a clicked toy spins up and settles, a sailboat's lap of
// the bay, and the sparks of a firework. Plain functions of time with no three.js, so they can be
// tested, and the ones that run every frame write into a caller's object instead of allocating.

/** One train of waves: its direction of travel on the ground, wavelength, speed and height. */
interface Wave {
  dirX: number;
  dirZ: number;
  length: number;
  /** Radians of phase per second. */
  speed: number;
  amplitude: number;
}

// Three trains crossing at angles, so the facets never line up into stripes.
export const WAVES: readonly Wave[] = [
  { dirX: 0.8, dirZ: 0.6, length: 9, speed: 1.1, amplitude: 0.09 },
  { dirX: -0.5, dirZ: 0.866, length: 5.5, speed: 1.7, amplitude: 0.05 },
  { dirX: 0.196, dirZ: -0.981, length: 14, speed: 0.7, amplitude: 0.07 },
];

/** The highest any point of the water can rise above (or fall below) still water. */
export const WAVE_REACH = WAVES.reduce((sum, w) => sum + w.amplitude, 0);

/** Height of the open water above still water at (x, z), `t` seconds in. */
export function waveHeight(x: number, z: number, t: number): number {
  let y = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    y +=
      w.amplitude * Math.sin(((2 * Math.PI) / w.length) * (w.dirX * x + w.dirZ * z) + w.speed * t);
  }
  return y;
}

/** The shores the swell calms against: line segments, and round islands. */
export interface Shores {
  segments: [Point, Point][];
  discs: { x: number; z: number; radius: number }[];
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = dx * dx + dz * dz;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Distance from a point on the water to the nearest shore; 0 at or inside one. */
export function shoreDistance(p: Point, shores: Shores): number {
  let best = Infinity;
  for (const [a, b] of shores.segments) best = Math.min(best, distanceToSegment(p, a, b));
  for (const d of shores.discs) best = Math.min(best, Math.hypot(p.x - d.x, p.z - d.z) - d.radius);
  return Math.max(0, best);
}

/** The shores of the bay: the coast, the breakwater and the lighthouse's rock. */
export function harbourShores(harbour: HarbourLayout): Shores {
  const { coast, lighthouse, breakwater } = harbour;
  const segments: [Point, Point][] = [];
  for (let i = 1; i < coast.length; i++) segments.push([coast[i - 1], coast[i]]);
  // The breakwater as a run of stones its width across: a line of small discs.
  const discs = [{ x: lighthouse.x, z: lighthouse.z, radius: lighthouse.island }];
  const { from, to, width } = breakwater;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  for (let d = 0; d <= length; d += width / 2) {
    const t = d / length;
    discs.push({
      x: from.x + (to.x - from.x) * t,
      z: from.z + (to.z - from.z) * t,
      radius: width / 2,
    });
  }
  return { segments, discs };
}

// Near a shore the swell calms, so the waves never wash over the foam or the rocks.
const SHORE_CALM = 6;

/** How much of the full swell reaches a point this far from shore: a little at the shore, all of it 6 out. */
export function shoreCalm(distance: number): number {
  return 0.15 + 0.85 * smoothstep(0, SHORE_CALM, distance);
}

const glslNumber = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * waveHeight as a GLSL function, `float waveHeight(vec2 p, float t)` with p = (x, z), written from
 * the same numbers so the water the shader draws is the water the boats ride.
 */
export function waveGlsl(): string {
  const terms = WAVES.map(
    (w) =>
      `${glslNumber(w.amplitude)} * sin(${glslNumber((2 * Math.PI) / w.length)} * dot(p, vec2(${glslNumber(w.dirX)}, ${glslNumber(w.dirZ)})) + ${glslNumber(w.speed)} * t)`,
  );
  return `float waveHeight(vec2 p, float t) {\n  return ${terms.join("\n    + ")};\n}\n`;
}

/** 0 → 0 → 1 → 1 with no jolt at either end. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * How hard a clicked toy is going, `since` seconds after the click: rising from 0 to 1 over
 * `rise`, holding, then settling back to 0 over the last 40% of `duration`. 0 before the click
 * and once it is over.
 */
export function toyBoost(since: number, duration: number, rise = 0.5): number {
  if (!(since >= 0) || since >= duration) return 0;
  return smoothstep(0, rise, since) * (1 - smoothstep(duration * 0.6, duration, since));
}

export interface Heading {
  x: number;
  z: number;
  /** three.js rotation.y that turns local +z (the bow) to face the way it moves. */
  heading: number;
}

/** A sailboat's mooring and the circle it sails round when clicked, which passes through it. */
export interface SailLap {
  x: number;
  z: number;
  /** Which way the bow points at the mooring. */
  heading: number;
  loop: { x: number; z: number; radius: number };
}

// Share of the lap spent turning from the moored heading onto the circle, and back at the end.
const TURN_SHARE = 0.1;

function turnTowards(from: number, to: number, t: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * t;
}

/**
 * Where a sailboat is `u` of the way round its lap (0 to 1): leaving its mooring, round the circle
 * clockwise as the map is seen from the south, and back. It eases away and eases in, and turns from its moored
 * heading onto the circle and back. Writes into `out`.
 */
export function sailAt(lap: SailLap, u: number, out: Heading): Heading {
  const { loop } = lap;
  const k = Math.min(Math.max(u, 0), 1);
  const eased = k * k * (3 - 2 * k);
  const start = Math.atan2(lap.x - loop.x, lap.z - loop.z);
  // Clockwise from the south (north up the screen): the angle from +z towards +x decreases.
  const a = start - eased * 2 * Math.PI;
  out.x = loop.x + loop.radius * Math.sin(a);
  out.z = loop.z + loop.radius * Math.cos(a);
  // The tangent along decreasing a.
  const tangent = Math.atan2(-Math.cos(a), Math.sin(a));
  const into = smoothstep(0, TURN_SHARE, k);
  const outOf = smoothstep(1 - TURN_SHARE, 1, k);
  out.heading = turnTowards(turnTowards(lap.heading, tangent, into), lap.heading, outOf);
  return out;
}

export const FIREWORK = {
  /** Seconds from launch to burst. */
  rise: 1.15,
  /** Seconds the sparks glow after the burst. */
  burn: 2.4,
  /** Sparks in one burst. */
  sparks: 110,
  /** How fast the sparks fly out, in units per second at the burst. */
  speed: 17,
  /** Drag: the sparks slow by e^-drag each second. */
  drag: 2.2,
  gravity: 2.6,
  /** Sparks that trail the rocket on its way up, each a little further behind. */
  trail: 6,
  /** Seconds between one trail spark and the next. */
  trailGap: 0.05,
};

/** The show's colours; a firework bursts in one of them. */
export const FIREWORK_COLOURS = ["#ff3d5a", "#ffb703", "#1fb6ff", "#9b5de5", "#38d66b", "#ff5fb8"];

/** Seconds from launch until a firework is spent. */
export const FIREWORK_LIFE = FIREWORK.rise + FIREWORK.burn;

export interface Spark {
  x: number;
  y: number;
  z: number;
  /** 0 (dark) to 1 (full). */
  glow: number;
}

// The golden angle spreads sparks evenly over a sphere (a Fibonacci sphere).
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Spark `i` of a firework `age` seconds after launch, as an offset from where it was launched
 * (on the water) to a burst `height` up. Before the burst only the first `trail` sparks glow: the
 * rocket climbing, and its trail fading out behind it. `seed` turns the burst so no two look the
 * same. Writes into `out`.
 */
export function sparkAt(i: number, age: number, height: number, seed: number, out: Spark): Spark {
  const { rise, burn, sparks, speed, drag, gravity, trail, trailGap } = FIREWORK;
  out.x = 0;
  out.z = 0;
  if (age < 0 || age >= rise + burn) {
    out.y = 0;
    out.glow = 0;
    return out;
  }
  if (age < rise) {
    // The rocket slows as it climbs, like a thrown ball; its trail is where it was a moment ago.
    const behind = i * trailGap;
    if (i >= trail || age < behind) {
      out.y = 0;
      out.glow = 0;
      return out;
    }
    const t = (age - behind) / rise;
    out.y = height * (1 - (1 - t) * (1 - t));
    out.glow = 0.95 * (1 - i / trail);
    return out;
  }
  const b = age - rise;
  const up = 1 - (2 * (i + 0.5)) / sparks;
  const ring = Math.sqrt(1 - up * up);
  const turn = i * GOLDEN + seed;
  const reach = (speed * (1 - Math.exp(-drag * b))) / drag;
  out.x = Math.cos(turn) * ring * reach;
  out.z = Math.sin(turn) * ring * reach;
  out.y = height + up * reach - 0.5 * gravity * b * b;
  const fade = 1 - b / burn;
  // A little flicker as they die, each spark out of step with its neighbours.
  const flicker = 0.75 + 0.25 * Math.sin(b * 23 + i * 1.7);
  out.glow = fade ** 1.3 * (b < 0.12 ? 1 : flicker);
  return out;
}

/** At most this many fireworks are in the air at once; a new one replaces the oldest. */
export const MAX_FIREWORKS = 10;
const BURST_HEIGHT = { min: 13, max: 20 };

/** Fireworks launched from the water, in a ring of MAX_FIREWORKS slots. */
export interface FireworkQueue {
  /** Clock seconds each slot was launched at; -Infinity while a slot has never been used. */
  times: Float64Array;
  xs: Float64Array;
  zs: Float64Array;
  heights: Float64Array;
  seeds: Float64Array;
  /** Which of the show's colours each slot bursts in. */
  colours: Uint8Array;
  /** How many have ever been launched; the next goes in slot launched % MAX_FIREWORKS. */
  launched: number;
}

export function createFireworkQueue(): FireworkQueue {
  return {
    times: new Float64Array(MAX_FIREWORKS).fill(-Infinity),
    xs: new Float64Array(MAX_FIREWORKS),
    zs: new Float64Array(MAX_FIREWORKS),
    heights: new Float64Array(MAX_FIREWORKS),
    seeds: new Float64Array(MAX_FIREWORKS),
    colours: new Uint8Array(MAX_FIREWORKS),
    launched: 0,
  };
}

/**
 * Launches a firework from (x, z) on the water at clock time `time`. Its height, turn and colour
 * follow from how many came before, so a show is the same every time it is clicked the same way.
 */
export function launchFirework(
  queue: FireworkQueue,
  x: number,
  z: number,
  time: number,
  colourCount: number,
): void {
  const n = queue.launched++;
  const slot = n % MAX_FIREWORKS;
  queue.times[slot] = time;
  queue.xs[slot] = x;
  queue.zs[slot] = z;
  // Golden-ratio steps spread heights, turns and colours without repeats.
  const step = (n * 0.618034) % 1;
  queue.heights[slot] = BURST_HEIGHT.min + step * (BURST_HEIGHT.max - BURST_HEIGHT.min);
  queue.seeds[slot] = n * 2.399963;
  queue.colours[slot] = (n * 3) % colourCount;
}

/** Clock time of the most recent launch, or -Infinity before the first. */
export function lastLaunch(queue: FireworkQueue): number {
  return queue.launched === 0 ? -Infinity : queue.times[(queue.launched - 1) % MAX_FIREWORKS];
}

/**
 * Where to restart a toy's clock when it's clicked again `since` seconds into its last go, so its
 * boost carries on rising from where it is instead of dropping to 0: a `since` in the rise whose
 * boost matches. A toy at rest, or done, starts from 0.
 */
export function restartBoost(since: number, duration: number, rise = 0.5): number {
  const now = toyBoost(since, duration, rise);
  if (now <= 0) return 0;
  // Inverse of smoothstep on [0, 1].
  const t = 0.5 - Math.sin(Math.asin(1 - 2 * now) / 3);
  return t * rise;
}

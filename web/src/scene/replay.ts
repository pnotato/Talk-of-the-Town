// Replaying the sim's walks: where each blob is, which way it faces, and what mood it is in at
// any moment of a run. Pure maths on the RunLog, so the scene and the tests share it, and the
// scene only ever shows what the sim decided (CLAUDE.md, hard rule 4).
//
// The playhead `t` counts ticks from the start of round 0. Round r's walk plays from r·T to
// (r+1)·T, where T is the map's ticksPerRound, and the round's social step lands as its walk
// ends. Between two ticks a blob moves in a straight line at constant speed, exactly as the
// planner assumed when it kept every pair of blobs 1.2 apart (docs/engine/PIBT.md). Easing one
// blob differently from another breaks that guarantee on screen: the tests catch it.
import type { Blob, Round, RunLog } from "../generated/types.ts";
import { type Mood, moodFor } from "./blobMood.ts";

/** Seconds per tick at 1× speed: a 1.8 step at 3 units a second, a full stride in blobMotion. */
export const TICK_SECONDS = 0.6;

/**
 * The parts of a RunLog the replay reads, so tests can build small runs. A blob's index into
 * town.blobs is its index into `start`, each round's scores and each round's `paths`, where
 * paths[b][k] is blob b's node after k ticks of the round's walk (k = 0 is where it starts).
 */
export type ReplayRun = Pick<RunLog, "map" | "start"> & {
  town: { blobs: Pick<Blob, "perception" | "interest">[] };
  rounds: Pick<Round, "events" | "perception" | "interest" | "paths">[];
};

/** Where a point is on the ground. */
export interface Ground {
  x: number;
  z: number;
}

/** How many ticks the run's walks last in all. */
export function runTicks(run: ReplayRun): number {
  return run.rounds.length * run.map.ticksPerRound;
}

/**
 * The index of the round whose walk is playing at `t`, held on the last round at the end of the
 * run; 0 when there are no rounds yet.
 */
export function roundAt(run: ReplayRun, t: number): number {
  const last = Math.max(run.rounds.length - 1, 0);
  return Math.min(Math.max(Math.floor(t / run.map.ticksPerRound), 0), last);
}

/** How many rounds are done at `t`: a round is done when its walk ends. */
export function roundsDone(run: ReplayRun, t: number): number {
  return Math.min(Math.max(Math.floor(t / run.map.ticksPerRound), 0), run.rounds.length);
}

// Where the playhead falls: in round `round`, the step from tick `tick` to tick + 1, a fraction
// `frac` of the way. Reused, so a frame's hundred lookups allocate nothing.
const at = { round: 0, tick: 0, frac: 0 };

/** Sets `at` for `t`, clamped to the run. The run must have rounds. */
function locate(run: ReplayRun, t: number) {
  const ticks = run.map.ticksPerRound;
  const clamped = Math.min(Math.max(t, 0), runTicks(run));
  at.round = roundAt(run, clamped);
  const into = clamped - at.round * ticks; // 0..ticks; only reaches ticks at the very end
  at.tick = Math.min(Math.floor(into), ticks - 1);
  at.frac = into - at.tick;
}

/**
 * Writes where blob `b` (an index into town.blobs) is at `t` into `out`, and returns `out`.
 * Clamped to the run; before any rounds, every blob is on its start node. With `snap`, it stays
 * on the last whole tick's node instead of moving in between (for reduced motion).
 */
export function positionAt<T extends Ground>(
  run: ReplayRun,
  b: number,
  t: number,
  out: T,
  snap = false,
): T {
  // Indexing rather than destructuring: a frame calls this a hundred times and must not allocate.
  const nodes = run.map.nodes;
  if (run.rounds.length === 0) {
    const p = nodes[run.start[b]];
    out.x = p[0];
    out.z = p[1];
    return out;
  }
  locate(run, t);
  const path = run.rounds[at.round].paths[b];
  const p = nodes[path[at.tick]];
  const q = nodes[path[at.tick + 1]];
  // A whole step done only happens at the very end of the run; snapping keeps it.
  const w = snap && at.frac < 1 ? 0 : at.frac;
  // Weighted so both ends are exactly the nodes' coordinates.
  out.x = p[0] * (1 - w) + q[0] * w;
  out.z = p[1] * (1 - w) + q[1] * w;
  return out;
}

/**
 * The way blob `b` faces while it steps at `t`, in radians about y with 0 facing +z, or null
 * while it stands (and before any rounds), so the caller holds the last one.
 */
export function headingAt(run: ReplayRun, b: number, t: number): number | null {
  if (run.rounds.length === 0) return null;
  locate(run, t);
  const path = run.rounds[at.round].paths[b];
  const from = path[at.tick];
  const to = path[at.tick + 1];
  if (from === to) return null;
  const p = run.map.nodes[from];
  const q = run.map.nodes[to];
  return Math.atan2(q[0] - p[0], q[1] - p[1]);
}

/**
 * Blob `b`'s mood once `done` rounds are done (roundsDone): from the town's starting scores
 * before round 0 is done, and from the scores after the last round that is done after that. A
 * round's scores show as its walk ends, which is when its social step happens in the sim.
 */
export function moodAt(run: ReplayRun, b: number, done: number): Mood {
  if (done <= 0) {
    const { perception, interest } = run.town.blobs[b];
    return moodFor(perception, interest);
  }
  const round = run.rounds[Math.min(done, run.rounds.length) - 1];
  return moodFor(round.perception[b], round.interest[b]);
}

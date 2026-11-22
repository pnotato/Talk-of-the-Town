// Staging the run's conversations on the city's hex grid. The sim decides who talks to whom
// (rounds[].events); the scene decides where they stand for it. Each in-person pair is given two
// neighbouring hex cells — one each — near the pair's midpoint, so both walk a similar distance,
// and the pair walks there over the first part of the round and talks on those cells for the rest.
//
// Everything here is pure and deterministic from the RunLog, so the same run always looks the
// same (issue #18: meeting spots derived from the run, not invented). No three.js, so the tests
// run under plain Node with the types stripped.
import { type Point, SPOT_SPACING } from "./mapLayout.ts";
import type { ReplayRun } from "./replay.ts";

/** A hex cell's neighbour sits one spacing away, give or take the log's 0.001 rounding. */
const ADJACENT_SLACK = 0.06;

/** The fraction of a round a pair spends walking to its cells before it starts talking. */
export const MEET_FRACTION = 0.55;

/**
 * The fraction of the next round a blob spends easing from where a conversation left it back onto
 * the sim's path. Staging moves a blob away from the path it walked in the sim, so the display has
 * to catch up; this keeps that catch-up continuous instead of a jump.
 */
export const CATCH_UP_FRACTION = 0.5;

/** One staged in-person conversation. Node indices index the run's `map.nodes`. */
export interface Conversation {
  /** The blob who spoke (the event's `f`). */
  speaker: number;
  /** The blob who heard it (the event's `to[0]`). */
  listener: number;
  /** The adjacent hex cells the two stand on. */
  speakerNode: number;
  listenerNode: number;
}

/** What a blob does in a staged conversation this round. */
export interface ConversationRole {
  /** True for the blob telling the story, false for the one listening. */
  speaker: boolean;
  /** The other blob's index. */
  partner: number;
  /** The hex cell this blob stands on. */
  node: number;
}

/** Where one blob is displayed over a round. */
export interface BlobStage {
  /** Its display position at the start of the round. */
  from: Point;
  /** Its conversation this round, or null when it just walks the sim's path. */
  role: ConversationRole | null;
  /** Its display position at the end of the round. */
  end: Point;
}

/** One round's staging: the conversations, and every blob's start and role. */
export interface RoundStaging {
  conversations: Conversation[];
  blobs: BlobStage[];
}

function nodePoint(nodes: readonly number[][], node: number): Point {
  const [x, z] = nodes[node];
  return { x, z };
}

function squaredDistance(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * The standing hex cells that touch, as node index pairs. Only `nodes[0:stand]` are standing spots,
 * laid on each area's own hex grid; neighbouring cells there are exactly one `SPOT_SPACING` apart.
 */
function adjacentPairs(run: ReplayRun): [number, number][] {
  const nodes = run.map.nodes;
  const stand = Math.min(run.map.stand, nodes.length);
  const near = SPOT_SPACING - ADJACENT_SLACK;
  const far = SPOT_SPACING + ADJACENT_SLACK;
  const [nearSq, farSq] = [near * near, far * far];
  const pairs: [number, number][] = [];
  for (let i = 0; i < stand; i++) {
    const [x, z] = nodes[i];
    for (let j = i + 1; j < stand; j++) {
      const gap = squaredDistance(x, z, nodes[j][0], nodes[j][1]);
      if (gap >= nearSq && gap <= farSq) pairs.push([i, j]);
    }
  }
  return pairs;
}

interface Placement {
  speakerNode: number;
  listenerNode: number;
  /** The longer of the two walks, squared: comparing squares is the same order, without a √. */
  farSq: number;
  /** Their sum, squared, to break a tie in favour of the shorter walk in all. */
  sumSq: number;
}

/**
 * The free adjacent pair of cells that needs the shortest walk for `speaker` and `listener`, trying
 * both ways round. Ties go to the lower node indices, so the choice is stable.
 */
function nearestPair(
  pairs: readonly [number, number][],
  nodes: readonly number[][],
  used: Uint8Array,
  speaker: Point,
  listener: Point,
): Placement | null {
  let best: Placement | null = null;
  for (const [i, j] of pairs) {
    if (used[i] || used[j]) continue;
    const [ix, iz] = nodes[i];
    const [jx, jz] = nodes[j];
    const speakerToI = squaredDistance(speaker.x, speaker.z, ix, iz);
    const listenerToJ = squaredDistance(listener.x, listener.z, jx, jz);
    const speakerToJ = squaredDistance(speaker.x, speaker.z, jx, jz);
    const listenerToI = squaredDistance(listener.x, listener.z, ix, iz);
    const straightFar = Math.max(speakerToI, listenerToJ);
    const straightSum = speakerToI + listenerToJ;
    const swappedFar = Math.max(speakerToJ, listenerToI);
    const swappedSum = speakerToJ + listenerToI;
    const swap =
      swappedFar < straightFar || (swappedFar === straightFar && swappedSum < straightSum);
    const farSq = swap ? swappedFar : straightFar;
    const sumSq = swap ? swappedSum : straightSum;
    const speakerNode = swap ? j : i;
    const listenerNode = swap ? i : j;
    if (
      best === null ||
      farSq < best.farSq ||
      (farSq === best.farSq &&
        (sumSq < best.sumSq ||
          (sumSq === best.sumSq &&
            (speakerNode < best.speakerNode ||
              (speakerNode === best.speakerNode && listenerNode < best.listenerNode)))))
    ) {
      best = { speakerNode, listenerNode, farSq, sumSq };
    }
  }
  return best;
}

/** Plans one round's staging: who meets where, given where everyone starts the round. */
function planRound(
  run: ReplayRun,
  round: number,
  from: readonly Point[],
  pairs: readonly [number, number][],
): RoundStaging {
  const nodes = run.map.nodes;
  const events = run.rounds[round].events;
  const count = run.town.blobs.length;
  const roles: (ConversationRole | null)[] = new Array(count).fill(null);
  const claimed = new Uint8Array(count);
  const used = new Uint8Array(nodes.length);

  // A blob who posts or scrolls this round acts alone, so it must not be pulled into a
  // conversation as well.
  for (const event of events) if (event.p || event.s) claimed[event.f] = 1;

  const conversations: Conversation[] = [];
  for (const event of events) {
    if (event.p || event.s || event.to.length !== 1) continue;
    const speaker = event.f;
    const listener = event.to[0];
    if (
      speaker === listener ||
      speaker < 0 ||
      listener < 0 ||
      speaker >= count ||
      listener >= count ||
      claimed[speaker] ||
      claimed[listener]
    ) {
      continue;
    }
    const placement = nearestPair(pairs, nodes, used, from[speaker], from[listener]);
    if (!placement) continue;
    used[placement.speakerNode] = 1;
    used[placement.listenerNode] = 1;
    claimed[speaker] = 1;
    claimed[listener] = 1;
    roles[speaker] = { speaker: true, partner: listener, node: placement.speakerNode };
    roles[listener] = { speaker: false, partner: speaker, node: placement.listenerNode };
    conversations.push({
      speaker,
      listener,
      speakerNode: placement.speakerNode,
      listenerNode: placement.listenerNode,
    });
  }

  const blobs: BlobStage[] = [];
  for (let b = 0; b < count; b++) {
    const role = roles[b];
    const path = run.rounds[round].paths[b];
    const end = role ? nodePoint(nodes, role.node) : nodePoint(nodes, path[path.length - 1]);
    blobs.push({ from: from[b], role, end });
  }
  return { conversations, blobs };
}

/**
 * Stages every round of the run. A round's `from` is the previous round's `end`, so a blob walks on
 * continuously from wherever a conversation left it. Rounds before any are staged start on their
 * `start` node. Empty when the run has no rounds.
 */
export function stageRun(run: ReplayRun): RoundStaging[] {
  if (run.rounds.length === 0) return [];
  const nodes = run.map.nodes;
  const count = run.town.blobs.length;
  const pairs = adjacentPairs(run);
  let from: Point[] = Array.from({ length: count }, (_, b) => nodePoint(nodes, run.start[b]));
  const staged: RoundStaging[] = [];
  for (let round = 0; round < run.rounds.length; round++) {
    const staging = planRound(run, round, from, pairs);
    staged.push(staging);
    from = staging.blobs.map((blob) => blob.end);
  }
  return staged;
}

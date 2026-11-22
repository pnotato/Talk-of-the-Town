import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Vector3Tuple } from "three";
import type { RunLog } from "../generated/types.ts";
import type { BlobActivity } from "../inspector/inspectorModel.ts";
import Blob, { type BlobDrive } from "./Blob.tsx";
import { useReducedMotion } from "./blobMedia.ts";
import { cityActivities } from "./cityActivity.ts";
import { SURFACE } from "./CityGround.tsx";
import { CATCH_UP_FRACTION, MEET_FRACTION, stageRun } from "./conversations.ts";
import {
  headingAt,
  moodAt,
  positionAt,
  roundAt,
  roundsDone,
  runTicks,
  TICK_SECONDS,
} from "./replay.ts";

// Before the blobs' own frames (priority 0), so they read this frame's positions. A negative
// priority only orders the callbacks; unlike a positive one it leaves R3F rendering by itself.
const BEFORE_BLOBS = -1;

// Where the sim's path puts a blob this frame, reused so a frame allocates nothing.
const simAt = { x: 0, z: 0 };

/** 0 → 0 → 1 → 1 with no jolt at either end. */
function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

interface Props {
  run: RunLog;
  playing: boolean;
  /** How many times faster than TICK_SECONDS the ticks play. */
  speed: number;
  /** Called with the index of the round whose walk is playing, each time it changes. */
  onRound?: (round: number) => void;
  /** Called once when the replay reaches the end of the run while playing. */
  onEnd?: () => void;
  /** The blob to ring, if the page has a selection. */
  selectedId?: number | null;
  /** Makes every blob clickable; called with the clicked blob's id. */
  onSelect?: (id: number) => void;
  /** Called when the round or the completed-round count changes, with everyone's activity. */
  onActivities?: (updates: Record<number, BlobActivity>) => void;
}

/**
 * The town walking the city as the sim moved it (replay.ts), one Blob per blob in the town, each
 * in the mood its scores give after the last round that is done.
 *
 * One playhead, in ticks, moves every blob: each frame it writes every blob's spot and heading
 * into that blob's `drive`, all at the same moment of the same tick. When the sim has a blob
 * talking to another (rounds[].events), the pair walks to two neighbouring hex cells and talks
 * there for the latter part of the round (conversations.ts), because the sim's wander can leave
 * partners across the city. Everyone else walks the sim's path, and a blob leaving a conversation
 * eases back onto it, so the walk keeps the spacing the sim guaranteed wherever it is shown.
 * Playing again after the end starts from the beginning. Reduced motion steps from tick to tick
 * instead of walking.
 */
export const CityReplay = memo(function CityReplay({
  run,
  playing,
  speed,
  onRound,
  onEnd,
  selectedId = null,
  onSelect,
  onActivities,
}: Props) {
  const reduceMotion = useReducedMotion();
  const playhead = useRef(0);
  // What the last frame reported, so callbacks and state change only when these do.
  const reported = useRef({ round: -1, done: 0, ended: false });
  const reportedActivities = useRef({ round: -1, done: -1 });
  const [done, setDone] = useState(0);

  // One drive per blob, made once per run and handed to its Blob once; frames mutate it.
  const drives = useMemo(
    () =>
      run.town.blobs.map((_, b) => {
        const drive: BlobDrive = { x: 0, z: 0, yaw: 0, talking: false, pose: "idle" };
        positionAt(run, b, 0, drive);
        drive.yaw = headingAt(run, b, 0) ?? 0; // facing the default camera until it first steps
        return drive;
      }),
    [run],
  );
  // Where each Blob first appears: feet on the paving.
  const positions = useMemo(() => drives.map((d): Vector3Tuple => [d.x, SURFACE, d.z]), [drives]);
  const moods = useMemo(() => run.town.blobs.map((_, b) => moodAt(run, b, done)), [run, done]);
  // Which pairs meet on adjacent hex cells this round, and where everyone starts it.
  const staging = useMemo(() => stageRun(run), [run]);
  const [shownRound, setShownRound] = useState(0);
  // The speakers this round, so their speech bubbles are mounted; frames decide when they show.
  const speakers = useMemo(() => {
    const speaking = new Set<number>();
    for (const conversation of staging[shownRound]?.conversations ?? []) {
      speaking.add(conversation.speaker);
    }
    return speaking;
  }, [staging, shownRound]);

  // Playing again after the end starts over.
  useEffect(() => {
    if (playing && playhead.current >= runTicks(run)) {
      playhead.current = 0;
      reported.current.ended = false;
    }
  }, [playing, run]);

  useFrame((_, delta) => {
    const end = runTicks(run);
    const seen = reported.current;
    if (playing && !seen.ended) {
      playhead.current = Math.min(playhead.current + (delta * speed) / TICK_SECONDS, end);
    }
    const t = playhead.current;
    const ticks = run.map.ticksPerRound;
    const round = roundAt(run, t);
    const into = t - round * ticks;
    const frac = ticks > 0 ? Math.min(Math.max(into / ticks, 0), 1) : 0;
    const stage = staging[round];

    for (let b = 0; b < drives.length; b++) {
      const drive = drives[b];
      const blob = stage?.blobs[b];
      const role = blob?.role;
      if (blob && role) {
        // Walk to this blob's hex cell, then stand on it and talk to its partner.
        const meet = run.map.nodes[role.node];
        const there = reduceMotion
          ? frac >= MEET_FRACTION
            ? 1
            : 0
          : smooth(Math.min(frac / MEET_FRACTION, 1));
        drive.x = blob.from.x + (meet[0] - blob.from.x) * there;
        drive.z = blob.from.z + (meet[1] - blob.from.z) * there;
        if (there >= 1) {
          const partner = stage.blobs[role.partner].role;
          const other = partner ? run.map.nodes[partner.node] : meet;
          drive.yaw = Math.atan2(other[0] - meet[0], other[1] - meet[1]);
          drive.talking = role.speaker;
          drive.pose = role.speaker ? "lean" : "idle";
        } else {
          const dx = meet[0] - blob.from.x;
          const dz = meet[1] - blob.from.z;
          if (dx !== 0 || dz !== 0) drive.yaw = Math.atan2(dx, dz);
          drive.talking = false;
          drive.pose = "idle";
        }
      } else {
        // Walk the sim's path, easing from wherever a conversation left this blob last round.
        positionAt(run, b, t, simAt, reduceMotion);
        const from = blob?.from ?? simAt;
        const back = reduceMotion ? 1 : smooth(Math.min(frac / CATCH_UP_FRACTION, 1));
        drive.x = from.x + (simAt.x - from.x) * back;
        drive.z = from.z + (simAt.z - from.z) * back;
        drive.talking = false;
        drive.pose = "idle";
        const heading = headingAt(run, b, t);
        if (heading !== null) drive.yaw = heading;
      }
    }

    if (round !== seen.round) {
      seen.round = round;
      setShownRound(round);
      onRound?.(round);
    }
    const nowDone = roundsDone(run, t);
    if (nowDone !== seen.done) {
      seen.done = nowDone;
      setDone(nowDone);
    }
    const shown = reportedActivities.current;
    if (round !== shown.round || nowDone !== shown.done) {
      shown.round = round;
      shown.done = nowDone;
      onActivities?.(cityActivities(run, round, nowDone));
    }
    if (playing && !seen.ended && t >= end) {
      seen.ended = true;
      onEnd?.();
    }
  }, BEFORE_BLOBS);

  return (
    <group>
      {run.town.blobs.map((blob, b) => (
        <Blob
          key={blob.id}
          id={blob.id}
          shape={blob.shape}
          age={blob.age}
          mood={moods[b]}
          idle
          talking={speakers.has(b)}
          selected={selectedId === blob.id}
          onSelect={onSelect}
          position={positions[b]}
          drive={drives[b]}
        />
      ))}
    </group>
  );
});

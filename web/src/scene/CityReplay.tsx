import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Vector3Tuple } from "three";
import type { RunLog } from "../generated/types.ts";
import Blob from "./Blob.tsx";
import { useReducedMotion } from "./blobMedia.ts";
import { SURFACE } from "./CityGround.tsx";
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

interface Props {
  run: RunLog;
  playing: boolean;
  /** How many times faster than TICK_SECONDS the ticks play. */
  speed: number;
  /** Called with the index of the round whose walk is playing, each time it changes. */
  onRound?: (round: number) => void;
  /** Called once when the replay reaches the end of the run while playing. */
  onEnd?: () => void;
}

/**
 * The town walking the city as the sim moved it (replay.ts), one Blob per blob in the town, each
 * in the mood its scores give after the last round that is done.
 *
 * One playhead, in ticks, moves every blob: each frame it writes every blob's spot and heading
 * into that blob's `drive`, all at the same moment of the same tick, so the blobs stay exactly as
 * far apart as the sim kept them. Nothing eases positions per blob. Playing again after the end
 * starts from the beginning. Reduced motion steps from tick to tick instead of walking.
 */
export const CityReplay = memo(function CityReplay({ run, playing, speed, onRound, onEnd }: Props) {
  const reduceMotion = useReducedMotion();
  const playhead = useRef(0);
  // What the last frame reported, so callbacks and state change only when these do.
  const reported = useRef({ round: -1, done: 0, ended: false });
  const [done, setDone] = useState(0);

  // One drive per blob, made once per run and handed to its Blob once; frames mutate it.
  const drives = useMemo(
    () =>
      run.town.blobs.map((_, b) => {
        const drive = positionAt(run, b, 0, { x: 0, z: 0, yaw: 0 });
        drive.yaw = headingAt(run, b, 0) ?? 0; // facing the default camera until it first steps
        return drive;
      }),
    [run],
  );
  // Where each Blob first appears: feet on the paving.
  const positions = useMemo(() => drives.map((d): Vector3Tuple => [d.x, SURFACE, d.z]), [drives]);
  const moods = useMemo(() => run.town.blobs.map((_, b) => moodAt(run, b, done)), [run, done]);

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
    for (let b = 0; b < drives.length; b++) {
      const drive = drives[b];
      positionAt(run, b, t, drive, reduceMotion);
      const heading = headingAt(run, b, t);
      if (heading !== null) drive.yaw = heading;
    }

    const round = roundAt(run, t);
    if (round !== seen.round) {
      seen.round = round;
      onRound?.(round);
    }
    const nowDone = roundsDone(run, t);
    if (nowDone !== seen.done) {
      seen.done = nowDone;
      setDone(nowDone);
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
          position={positions[b]}
          drive={drives[b]}
        />
      ))}
    </group>
  );
});

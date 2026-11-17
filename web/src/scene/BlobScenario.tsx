import { useEffect, useState } from "react";
import type { Vector3Tuple } from "three";
import Blob from "./Blob.tsx";
import type { Scenario } from "./blobScenarios.ts";

/**
 * Plays a scenario on a loop around `position`. The beat is React state that advances on a timer;
 * each Blob eases towards its part in it. `firstId` seeds the actors' animation phases.
 */
export default function BlobScenario({
  scenario,
  position: [cx, cy, cz],
  firstId,
}: {
  scenario: Scenario;
  position: Vector3Tuple;
  firstId: number;
}) {
  const [index, setIndex] = useState(0);
  const beat = scenario.beats[index];
  const beats = scenario.beats.length;

  useEffect(() => {
    const timer = setTimeout(() => setIndex((i) => (i + 1) % beats), beat.seconds * 1000);
    return () => clearTimeout(timer);
  }, [beat, beats]);

  return scenario.actors.map((actor, i) => {
    const part = beat.actors[i];
    return (
      <Blob
        key={i}
        id={firstId + i}
        shape={actor.shape}
        age={actor.age}
        mood={part.mood}
        pose={part.pose}
        talking={part.talking}
        position={[cx + (part.x ?? actor.x), cy, cz]}
        yaw={part.yaw ?? actor.yaw}
      />
    );
  });
}

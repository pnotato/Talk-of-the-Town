import { useEffect, useState } from "react";
import type { Vector3Tuple } from "three";
import type { BlobActivity } from "../inspector/BlobSelection.tsx";
import Blob from "./Blob.tsx";
import { beatActivities } from "./blobActivity.ts";
import type { Scenario } from "./blobScenarios.ts";

/**
 * Plays a scenario on a loop around `position`. The beat is React state that advances on a timer;
 * each Blob eases towards its part in it. `firstId` seeds the actors' animation phases and
 * identifies them: actor `i` is blob `firstId + i`.
 *
 * `onSelect` makes the actors clickable and `selectedId` rings the selected one. Both are
 * optional, and `onSelect` should be a stable function. `onActivityChange` is called once per
 * beat (not per frame) with what every actor is doing in it, by blob id; it should be stable too.
 */
export default function BlobScenario({
  scenario,
  position: [cx, cy, cz],
  firstId,
  selectedId = null,
  onSelect,
  onActivityChange,
}: {
  scenario: Scenario;
  position: Vector3Tuple;
  firstId: number;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  onActivityChange?: (updates: Record<number, BlobActivity>) => void;
}) {
  const [index, setIndex] = useState(0);
  const beat = scenario.beats[index];
  const beats = scenario.beats.length;

  useEffect(() => {
    const timer = setTimeout(() => setIndex((i) => (i + 1) % beats), beat.seconds * 1000);
    return () => clearTimeout(timer);
  }, [beat, beats]);

  useEffect(() => {
    onActivityChange?.(beatActivities(scenario, index, firstId));
  }, [scenario, index, firstId, onActivityChange]);

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
        selected={selectedId === firstId + i}
        onSelect={onSelect}
      />
    );
  });
}

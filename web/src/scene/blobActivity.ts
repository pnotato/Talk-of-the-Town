import type { BlobActivity } from "../inspector/BlobSelection.tsx";
import { MOODS } from "./blobMood.ts";
import type { Actor, ActorBeat, Scenario } from "./blobScenarios.ts";
import { shapesFixture } from "./shapesFixture.ts";

// What each blob in the Shapes sandbox is doing, for the inspector. Derived from what the scene
// shows, never invented: a blob talks while its scenario beat has it talking, listens while a
// partner talks, posts while it holds the phone, and walks while its beat moves it.

/** The sandbox ids: the shape grid is 1..18, mood samples 100+, scenario actors 200+10*i+j. */
export const MOOD_FIRST_ID = 100;
export const scenarioFirstId = (scenarioIndex: number) => 200 + 10 * scenarioIndex;

const spot = (actor: Actor, part: ActorBeat) => part.x ?? actor.x;

/**
 * Every actor's activity during beat `index` of a scenario, by blob id (`firstId + actor index`).
 *
 * - posting: the actor holds the phone.
 * - talking: the actor's beat has it talking; its partner is the closest other actor.
 * - listening: someone else is talking and the actor is neither talking nor posting. Its partner
 *   is the closest talker. Two talkers (an argument) are each other's partner.
 * - walking: the beat moves the actor from where the previous beat (cyclically) left it.
 *
 * An actor that does none of these is idle. Posting, then walking, then talking win over
 * listening, because those are what the blob visibly does.
 */
export function beatActivities(
  { actors, beats }: Scenario,
  index: number,
  firstId: number,
): Record<number, BlobActivity> {
  const beat = beats[index];
  const before = beats[(index + beats.length - 1) % beats.length];
  const gap = (i: number, j: number) =>
    Math.abs(spot(actors[i], beat.actors[i]) - spot(actors[j], beat.actors[j]));
  /** The candidate other than `i` standing closest to it; the first of any tie. */
  const closest = (i: number, candidates: number[]) => {
    let best: number | undefined;
    for (const j of candidates) {
      if (j !== i && (best === undefined || gap(i, j) < gap(i, best))) best = j;
    }
    return best;
  };
  const all = actors.map((_, i) => i);
  const talkers = all.filter((i) => beat.actors[i].talking && beat.actors[i].pose !== "phone");

  const result: Record<number, BlobActivity> = {};
  for (const i of all) {
    const part = beat.actors[i];
    const mood = part.mood;
    let activity: BlobActivity;
    if (part.pose === "phone") {
      activity = { state: "posting", mood };
    } else if (spot(actors[i], part) !== spot(actors[i], before.actors[i])) {
      activity = { state: "walking", mood };
    } else if (talkers.includes(i)) {
      // Talking to the closest other talker if there is one (an argument), else to whoever is
      // closest, who is then shown listening.
      const partner = closest(i, talkers) ?? closest(i, all);
      activity =
        partner === undefined
          ? { state: "talking", mood }
          : { state: "talking", mood, partnerId: firstId + partner };
    } else if (talkers.some((t) => t !== i)) {
      activity = { state: "listening", mood, partnerId: firstId + closest(i, talkers)! };
    } else {
      activity = { state: "idle", mood };
    }
    result[firstId + i] = activity;
  }
  return result;
}

/** The activities of the blobs that never change: the shape grid and the mood samples. */
export function staticActivities(): Record<number, BlobActivity> {
  const result: Record<number, BlobActivity> = {};
  // A Blob with no mood prop wears a smile.
  for (const { id } of shapesFixture) result[id] = { state: "idle", mood: "smile" };
  MOODS.forEach((mood, i) => {
    result[MOOD_FIRST_ID + i] = { state: "idle", mood };
  });
  return result;
}

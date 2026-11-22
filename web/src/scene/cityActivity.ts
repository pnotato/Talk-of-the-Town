// What every city blob is doing in a round, for the inspector. Derived from what the sim recorded
// (rounds[].events and paths), never invented: a blob talks when it is an event's speaker, listens
// when it is an in-person listener, posts when it holds the phone, scrolls when it reads a post,
// and walks when its path moves. Scores and moods come from the same replay helpers the blobs
// themselves use.
import type { RunLog } from "../generated/types.ts";
import type { BlobActivity } from "../inspector/inspectorModel.ts";
import { moodAt } from "./replay.ts";

/**
 * Every blob's activity in `round` (an index into the run's rounds) after `done` rounds have
 * completed. Posting wins over scrolling, then talking, listening and walking, because those are
 * what the blob visibly does. The scores are the ones the replay shows at that point: the town's
 * starting values before round 0 is done, then the completed round's scores.
 */
export function cityActivities(
  run: RunLog,
  round: number,
  done: number,
): Record<number, BlobActivity> {
  const count = run.town.blobs.length;
  const posting = new Uint8Array(count);
  const scrolling = new Uint8Array(count);
  const speakerPartner = new Int32Array(count).fill(-1);
  const listenerPartner = new Int32Array(count).fill(-1);

  const roundIndex =
    run.rounds.length === 0 ? -1 : Math.min(Math.max(round, 0), run.rounds.length - 1);
  const events = roundIndex < 0 ? [] : run.rounds[roundIndex].events;
  for (const event of events) {
    if (event.p) {
      if (event.f >= 0 && event.f < count) posting[event.f] = 1;
      continue;
    }
    if (event.s) {
      if (event.f >= 0 && event.f < count) scrolling[event.f] = 1;
      continue;
    }
    if (event.to.length !== 1) continue;
    const speaker = event.f;
    const listener = event.to[0];
    if (
      speaker < 0 ||
      listener < 0 ||
      speaker >= count ||
      listener >= count ||
      speaker === listener
    ) {
      continue;
    }
    // A blob speaks at most once a round, but may be told the story by several speakers.
    if (speakerPartner[speaker] < 0) speakerPartner[speaker] = listener;
    if (listenerPartner[listener] < 0) listenerPartner[listener] = speaker;
  }

  const scores = done > 0 ? run.rounds[Math.min(done, run.rounds.length) - 1] : null;
  const path = roundIndex < 0 ? null : run.rounds[roundIndex].paths;

  const activities: Record<number, BlobActivity> = {};
  for (let b = 0; b < count; b++) {
    const mood = moodAt(run, b, done);
    const perception = scores ? scores.perception[b] : run.town.blobs[b].perception;
    const interest = scores ? scores.interest[b] : run.town.blobs[b].interest;
    let walking = false;
    if (path) {
      const steps = path[b];
      for (let k = 1; k < steps.length; k++) {
        if (steps[k] !== steps[k - 1]) {
          walking = true;
          break;
        }
      }
    }

    let activity: BlobActivity;
    if (posting[b]) {
      activity = { state: "posting", mood, perception, interest };
    } else if (scrolling[b]) {
      activity = { state: "scrolling", mood, perception, interest };
    } else if (speakerPartner[b] >= 0) {
      activity = {
        state: "talking",
        mood,
        partnerId: speakerPartner[b],
        perception,
        interest,
      };
    } else if (listenerPartner[b] >= 0) {
      activity = {
        state: "listening",
        mood,
        partnerId: listenerPartner[b],
        perception,
        interest,
      };
    } else if (walking) {
      activity = { state: "walking", mood, perception, interest };
    } else {
      activity = { state: "idle", mood, perception, interest };
    }
    activities[b] = activity;
  }
  return activities;
}

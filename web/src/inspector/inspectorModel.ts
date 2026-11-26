import type { Mood } from "../scene/blobMood.ts";

// Pure helpers for the blob inspector: wording for scores and activities, and selection stepping.
// No sim rules live here. Everything the inspector shows is either authored sandbox data or
// words for it.

/** What a blob is doing right now, as reported by the scene. */
export type BlobActivity = {
  state: "idle" | "talking" | "listening" | "posting" | "scrolling" | "walking";
  mood: Mood;
  partnerId?: number;
  /** The blob's live scores, when the scene knows them (the city run does). */
  perception?: number;
  interest?: number;
  /** What the blob said or posted this round, when the run has words. */
  says?: string;
  /** What reached the blob this round: what it was told, or the post it read. */
  heard?: string;
  /** What the blob thought this round: why it spoke, or how it took what it heard. */
  thought?: string;
};

export function sameActivity(a: BlobActivity | undefined, b: BlobActivity): boolean {
  return (
    a !== undefined &&
    a.state === b.state &&
    a.mood === b.mood &&
    a.partnerId === b.partnerId &&
    a.perception === b.perception &&
    a.interest === b.interest &&
    a.says === b.says &&
    a.heard === b.heard &&
    a.thought === b.thought
  );
}

/**
 * Words for a 0–100 score. The edges match the bands `moodFor` uses (perception 20, 38, 62;
 * interest 15, 50, 70), so the text and the blob's face never disagree about which band a score is in.
 */
export function perceptionLabel(perception: number): string {
  if (perception >= 62) return "Favourable";
  if (perception >= 38) return "Undecided";
  if (perception >= 20) return "Doubtful";
  return "Hostile";
}

export function interestLabel(interest: number): string {
  if (interest >= 70) return "Very interested";
  if (interest >= 50) return "Interested";
  if (interest >= 15) return "Mildly interested";
  return "Not interested";
}

/** Clamps a score to 0–100 and rounds it, for display and `aria-valuenow`. */
export function displayScore(score: number): number {
  return Math.round(Math.min(100, Math.max(0, score)));
}

const ACTIVITY_TEXT: Record<BlobActivity["state"], string> = {
  idle: "Idle",
  talking: "Talking",
  listening: "Listening",
  posting: "Posting to social media",
  scrolling: "Scrolling social media",
  walking: "Walking",
};

export function activityText(activity: BlobActivity | undefined): string {
  return ACTIVITY_TEXT[activity?.state ?? "idle"];
}

/**
 * The blob's current action as one phrase and, for talking and listening, who it is with. The
 * partner is only the one the scene reports, so "Talking to" never appears without a partner and
 * a blob nobody is talking with is simply "Talking".
 */
export function describeAction(activity: BlobActivity | undefined): {
  text: string;
  partnerId?: number;
} {
  const text = activityText(activity);
  const partnerId = activity?.partnerId;
  if (
    partnerId === undefined ||
    (activity?.state !== "talking" && activity?.state !== "listening")
  ) {
    return { text };
  }
  return { text: `${text} to`, partnerId };
}

/**
 * The next (`step` 1) or previous (`step` -1) id in `order`, wrapping round. With nothing selected,
 * stepping forward gives the first and stepping back the last.
 */
export function stepSelection(order: readonly number[], current: number | null, step: 1 | -1) {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at === -1) return step === 1 ? order[0] : order[order.length - 1];
  return order[(at + step + order.length) % order.length];
}

/** Capitalises the first letter: "square" → "Square". */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

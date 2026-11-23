// The playback bar's chart: the town's average perception and interest round by round, and where
// each announcement falls. Pure maths on the RunLog, so the tests can check it without a browser.
import type { Blob, MomentLog, Pending, Round } from "../generated/types.ts";

/** The parts of a RunLog the chart reads, so tests can build small runs. */
export type PulseRun = {
  town: { blobs: Pick<Blob, "perception" | "interest">[] };
  rounds: Pick<Round, "avgPerception" | "avgInterest">[];
  moments: Pick<MomentLog, "id" | "round" | "headline">[];
  next: Pick<Pending, "id" | "round"> | null;
};

/** The town's average scores: index 0 before any round, index k once k rounds are done. */
export type PulseSeries = { perception: number[]; interest: number[] };

/** A point on the bar where an announcement is made. */
export type TimelineMarker = {
  id: string;
  /** Where on the bar it falls, 0–1. */
  share: number;
  /** The round it opens, counted from 1. */
  round: number;
  /** Null until the replay reaches it, so the bar never gives the story away. */
  headline: string | null;
  past: boolean;
};

function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), high);
}

function mean(values: readonly number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function pulseSeries(run: PulseRun): PulseSeries {
  const blobs = run.town.blobs;
  return {
    perception: [mean(blobs.map((b) => b.perception)), ...run.rounds.map((r) => r.avgPerception)],
    interest: [mean(blobs.map((b) => b.interest)), ...run.rounds.map((r) => r.avgInterest)],
  };
}

/**
 * How many rounds are done while `round` (an index) plays: every round before it, or all of them
 * once the replay has ended.
 */
export function roundsDoneAt(round: number, ended: boolean, total: number): number {
  return ended ? total : clamp(round, 0, total);
}

/** The town's scores once `done` rounds are done, rounded for display. */
export function pulseAt(series: PulseSeries, done: number) {
  const at = clamp(done, 0, series.perception.length - 1);
  return {
    perception: Math.round(series.perception[at] ?? 0),
    interest: Math.round(series.interest[at] ?? 0),
  };
}

/** A score range for the chart, low to high. */
export type PulseDomain = readonly [number, number];

const MIN_SPAN = 20;

/**
 * The chart's score range: every score in the run, widened out to whole tens and to at least
 * MIN_SPAN points, within 0–100. It covers the whole run, not just the rounds played, so the lines
 * never rescale under the viewer as the replay goes on.
 */
export function pulseDomain(series: PulseSeries): PulseDomain {
  const all = [...series.perception, ...series.interest];
  if (all.length === 0) return [0, 100];
  let low = Math.max(0, Math.floor(Math.min(...all) / 10) * 10);
  let high = Math.min(100, Math.ceil(Math.max(...all) / 10) * 10);
  while (high - low < MIN_SPAN) {
    if (low > 0) low -= 10;
    if (high - low < MIN_SPAN && high < 100) high += 10;
  }
  return [low, high];
}

/** Where on the bar (0–1) round index `round` starts, out of `total` rounds. */
export function roundShare(round: number, total: number): number {
  return total <= 0 ? 0 : clamp(round / total, 0, 1);
}

const twoPlaces = (n: number) => Math.round(n * 100) / 100;

/**
 * An SVG path through values[0..done]: x spreads `total` rounds across `width`, and `domain` maps
 * onto `height`, its top score at the top. Nothing past `done` is drawn, so the line grows as the
 * replay plays.
 */
export function sparkPath(
  values: readonly number[],
  done: number,
  total: number,
  width: number,
  height: number,
  domain: PulseDomain = [0, 100],
): string {
  const last = Math.min(done, values.length - 1);
  const [low, high] = domain;
  if (last < 0 || total <= 0 || high <= low) return "";
  const points: string[] = [];
  for (let k = 0; k <= last; k++) {
    const x = twoPlaces((k / total) * width);
    const y = twoPlaces(height - ((clamp(values[k], low, high) - low) / (high - low)) * height);
    points.push(`${k === 0 ? "M" : "L"}${x} ${y}`);
  }
  return points.join(" ");
}

/**
 * Every announcement on the bar while round index `round` plays: the ones made, with their
 * headlines, and the ones still to come (including the pending one), without.
 */
export function markersAt(run: PulseRun, round: number): TimelineMarker[] {
  const total = run.rounds.length;
  const moments: Pick<MomentLog, "id" | "round" | "headline">[] = [...run.moments];
  if (run.next && !moments.some((m) => m.id === run.next?.id)) {
    moments.push({ id: run.next.id, round: run.next.round, headline: "" });
  }
  return moments.map((m) => {
    const past = m.round <= round && run.moments.includes(m);
    return {
      id: m.id,
      share: roundShare(m.round, total),
      round: m.round + 1,
      headline: past ? m.headline : null,
      past,
    };
  });
}

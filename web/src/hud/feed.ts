// The news feed: what the company has announced and shipped by the playing round, newest first.
// Every item comes from the RunLog's moments; the only words added here are for comparing what was
// claimed with what was delivered.
import type { MomentLog } from "../generated/types.ts";

export type FeedMoment = Pick<
  MomentLog,
  "id" | "round" | "headline" | "claimed" | "delivered" | "shipped" | "shippedRound" | "broken"
>;

/** How a shipped feature measured up to its announcement. */
export type ShipVerdict = "beat" | "kept" | "broken";

export type FeedItem = {
  key: string;
  kind: "announced" | "shipped";
  /** The round it happened in, counted from 1. */
  round: number;
  headline: string;
  claimed: number;
  delivered: number;
  /** Only for a shipped feature. */
  verdict?: ShipVerdict;
};

export const VERDICT_TEXT: Record<ShipVerdict, string> = {
  beat: "Better than claimed",
  kept: "As claimed",
  broken: "Broken promise",
};

/** The sim's broken flag decides first; otherwise a delivery above the claim beat it. */
export function shipVerdict(moment: Pick<FeedMoment, "claimed" | "delivered" | "broken">) {
  if (moment.broken) return "broken";
  return moment.delivered > moment.claimed ? "beat" : "kept";
}

/**
 * The feed while round index `round` plays. An announcement is made, and a feature ships, before
 * the round it is logged for plays; within a round the ship comes after the announcement, so it is
 * listed first.
 */
export function feedAt(moments: readonly FeedMoment[], round: number): FeedItem[] {
  // Each item with when it happened (a round index) and, within that round, its order.
  const entries: { at: number; order: number; item: FeedItem }[] = [];
  for (const m of moments) {
    const base = { headline: m.headline, claimed: m.claimed, delivered: m.delivered };
    if (m.round <= round) {
      entries.push({
        at: m.round,
        order: 0,
        item: { ...base, key: `${m.id}-announced`, kind: "announced", round: m.round + 1 },
      });
    }
    if (m.shipped && m.shippedRound >= 0 && m.shippedRound <= round) {
      entries.push({
        at: m.shippedRound,
        order: 1,
        item: {
          ...base,
          key: `${m.id}-shipped`,
          kind: "shipped",
          round: m.shippedRound + 1,
          verdict: shipVerdict(m),
        },
      });
    }
  }
  entries.sort((a, b) => b.at - a.at || b.order - a.order);
  return entries.map((entry) => entry.item);
}

/** The latest announcement made while round index `round` plays. */
export function headlineAt<M extends Pick<MomentLog, "round">>(
  moments: readonly M[],
  round: number,
): M | undefined {
  return moments.findLast((m) => m.round <= round);
}

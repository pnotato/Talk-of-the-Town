// PLACEHOLDER FIXTURE: a made-up crowd to show the city full of blobs before there is a sim to
// replay. Nothing here is sim output. The real town comes from /api/town and the RunLog, and
// then the scene replays the sim (CLAUDE.md, hard rule 4) and this file goes.
//
// Pure and seeded: the same seed and cells always give the same crowd.
import { SHAPES, type Shape } from "./blobGeometry.ts";
import { MOODS, type Mood } from "./blobMood.ts";
import { type Point, seededRandom } from "./mapLayout.ts";

/** About 100 blobs, as in a run (CLAUDE.md). */
export const CROWD_SIZE = 100;
/** The crowd the city shows on first load. */
export const DEFAULT_CROWD_SEED = 1;

/** Age bands and their shares of the town, from docs/BLOBS.md; ages are whole years. */
export const AGE_BANDS = [
  { group: "child", from: 0, to: 17, share: 0.2 },
  { group: "adult", from: 18, to: 64, share: 0.6 },
  { group: "elder", from: 65, to: 94, share: 0.2 },
] as const;

/**
 * Yaws are spread this far either side of facing +z, towards the default camera, which looks
 * north from the south. Turned any further, a face is hidden from the player.
 */
export const FACING_SPREAD = Math.PI / 3;

export interface CrowdBlob {
  id: number;
  /** Index of the cell it stands in. */
  cell: number;
  x: number;
  z: number;
  shape: Shape;
  age: number;
  /** Its body colour follows from this (MOOD_COLOR). */
  mood: Mood;
  /** Radians about y; 0 faces +z. */
  yaw: number;
}

/**
 * `count` blobs, each in its own cell, picked uniformly from all of `cells` (not nearest the
 * middle first). Shape and mood are uniform; ages are dealt in the docs/BLOBS.md shares, each
 * an exact age inside its band. Throws a RangeError when there are more blobs than cells.
 */
export function scatterCrowd(seed: number, cells: readonly Point[], count: number): CrowdBlob[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a whole number >= 0, got ${count}`);
  }
  if (count > cells.length) {
    throw new RangeError(
      `${count} blobs can't each have a cell of their own: only ${cells.length}`,
    );
  }
  const random = seededRandom(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];

  // Cells: the first `count` steps of a Fisher-Yates shuffle, so every cell is equally likely.
  const order = Array.from(cells, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (cells.length - i));
    [order[i], order[j]] = [order[j], order[i]];
  }

  // Age bands: each band's share rounded, the remainder to adults, then shuffled.
  const [child, adult, elder] = AGE_BANDS;
  const children = Math.round(count * child.share);
  const elders = Math.min(Math.round(count * elder.share), count - children);
  const bands = Array.from({ length: count }, (_, i) =>
    i < children ? child : i < count - elders ? adult : elder,
  );
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [bands[i], bands[j]] = [bands[j], bands[i]];
  }

  return bands.map((band, i) => {
    const cell = order[i];
    return {
      id: i + 1,
      cell,
      x: cells[cell].x,
      z: cells[cell].z,
      shape: pick(SHAPES),
      age: band.from + Math.floor(random() * (band.to - band.from + 1)),
      mood: pick(MOODS),
      yaw: (2 * random() - 1) * FACING_SPREAD,
    };
  });
}

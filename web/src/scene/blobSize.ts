import type { Vector3Tuple } from "three";

export type AgeGroup = "child" | "adult" | "elder";

export const AGE_GROUPS: readonly AgeGroup[] = ["child", "adult", "elder"];

/** Age bands from docs/BLOBS.md: child 0–17, adult 18–64, elder 65+. */
export function ageGroup(age: number): AgeGroup {
  if (age < 18) return "child";
  if (age < 65) return "adult";
  return "elder";
}

// Size is age. Children are 60% of an adult, clearly the smallest. Elders are only a little bigger
// (about 1.1 overall), which perspective can cancel when an elder stands a row behind an adult. So
// the elder cue is mostly proportion: 20% wider but only 5% taller, a stockier blob at any distance.
const SCALE: Record<AgeGroup, Readonly<Vector3Tuple>> = {
  child: [0.6, 0.6, 0.6],
  adult: [1, 1, 1],
  elder: [1.2, 1.05, 1.2],
};

/** Width, height and depth multipliers applied to a blob's adult-sized geometry. */
export function blobScale(age: number): Readonly<Vector3Tuple> {
  return SCALE[ageGroup(age)];
}

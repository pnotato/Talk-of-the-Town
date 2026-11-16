import type { Vector3Tuple } from "three";

export type AgeGroup = "child" | "adult" | "elder";

export const AGE_GROUPS: readonly AgeGroup[] = ["child", "adult", "elder"];

/** Age bands from docs/BLOBS.md: child 0–17, adult 18–64, elder 65+. */
export function ageGroup(age: number): AgeGroup {
  if (age < 18) return "child";
  if (age < 65) return "adult";
  return "elder";
}

// Size is age: a blob grows with each band, as in docs/blobs.png. Children are 60% of an adult,
// clearly the smallest. Elders are 14% taller but 32% wider, so they are stockier as well as
// bigger: that change in proportion survives perspective, which in the town can make a near adult
// look as big as a far elder.
const SCALE: Record<AgeGroup, Readonly<Vector3Tuple>> = {
  child: [0.6, 0.6, 0.6],
  adult: [1, 1, 1],
  elder: [1.32, 1.14, 1.32],
};

/** Width, height and depth multipliers applied to a blob's adult-sized geometry. */
export function blobScale(age: number): Readonly<Vector3Tuple> {
  return SCALE[ageGroup(age)];
}

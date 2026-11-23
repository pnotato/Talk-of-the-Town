// The People panel's directory: the town's mood mix and a search over its residents. Pure, so the
// tests can check it without a browser.
import { MOODS, type Mood } from "../scene/blobMood.ts";
import { ageGroup } from "../scene/blobSize.ts";
import type { BlobProfile } from "../inspector/blobProfiles.ts";

/** The parts of a profile the search reads. */
export type PersonFields = Pick<BlobProfile, "id" | "name" | "shape" | "age" | "traits">;

/** How many of `ids` wear each mood, happiest first; moods nobody wears are left out. */
export function moodMix(
  ids: readonly number[],
  moodOf: (id: number) => Mood,
): { mood: Mood; count: number }[] {
  const counts = new Map<Mood, number>();
  for (const id of ids) {
    const mood = moodOf(id);
    counts.set(mood, (counts.get(mood) ?? 0) + 1);
  }
  return MOODS.filter((mood) => counts.has(mood)).map((mood) => ({
    mood,
    count: counts.get(mood) ?? 0,
  }));
}

/** Lower case, without accents, so "zoe" finds "Zoë". */
function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * The people matching `query` and `mood`, in their original order. Every word of the query must
 * match: anywhere in the name, or the start of the blob's shape, age group or one of its traits.
 */
export function filterPeople<P extends PersonFields>(
  people: readonly P[],
  query: string,
  mood: Mood | null,
  moodOf: (id: number) => Mood,
): P[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return people.filter((person) => {
    if (mood !== null && moodOf(person.id) !== mood) return false;
    if (words.length === 0) return true;
    const name = fold(person.name);
    const tags = [person.shape, ageGroup(person.age), ...person.traits];
    return words.every((word) => name.includes(word) || tags.some((tag) => tag.startsWith(word)));
  });
}

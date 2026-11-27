// The city's blob catalog for the inspector: the run's own residents, with their live activity and
// scores reported by the replay. Nothing is authored here; every field comes from the RunLog.
import type { RunLog } from "../generated/types.ts";
import { moodForEmotions } from "../scene/blobMood.ts";
import { type BlobCatalog, type BlobProfile, GROUP_TITLES } from "./blobProfiles.ts";

export const CITY_SOURCE = "Simulated run";
export const CITY_NOTE = "Scores from the RunLog; activity is live";

/** The catalog shown before a run has loaded, so the inspector can mount empty. */
export const EMPTY_CITY_CATALOG: BlobCatalog = {
  get: () => undefined,
  order: [],
  groups: [],
  source: CITY_SOURCE,
  note: "Waiting for the run",
  description: `${CITY_SOURCE} · Waiting for the run.`,
  subtitle: "Every resident in the city",
};

/**
 * Builds the inspector's catalog from `run`. Scores and emotions start at the town's starting
 * values; the replay reports each blob's live scores, emotions and mood as the rounds play (see
 * scene/cityActivity.ts), and the card prefers those over these starting values.
 */
export function cityCatalog(run: RunLog): BlobCatalog {
  const parents = new Map<number, number[]>();
  const children = new Map<number, number[]>();
  for (const family of run.town.families) {
    for (const parent of family.parents) {
      children.set(parent, [...(children.get(parent) ?? []), ...family.children]);
    }
    for (const child of family.children) {
      parents.set(child, [...(parents.get(child) ?? []), ...family.parents]);
    }
  }

  const profiles: BlobProfile[] = run.town.blobs.map((blob) => ({
    id: blob.id,
    name: blob.name,
    shape: blob.shape,
    age: blob.age,
    traits: blob.traits,
    perception: blob.perception,
    interest: blob.interest,
    emotions: blob.emotions,
    mood: moodForEmotions(blob.emotions),
    group: "city",
    place: "City",
    parentIds: parents.get(blob.id) ?? [],
    childIds: children.get(blob.id) ?? [],
  }));
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));

  return {
    get: (id) => byId.get(id),
    order: profiles.map((profile) => profile.id),
    groups: [{ key: "city", title: GROUP_TITLES.city, profiles }],
    source: CITY_SOURCE,
    note: CITY_NOTE,
    description: `${CITY_SOURCE} · ${CITY_NOTE}.`,
    subtitle: `Every resident in the city (${profiles.length})`,
  };
}

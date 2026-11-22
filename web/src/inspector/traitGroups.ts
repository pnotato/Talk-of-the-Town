import { type BlobProfile, TRAIT_MEANING as MEANING, type Trait } from "./blobProfiles.ts";

// Splits a profile's tags for the inspector: the special tags (a leader, a recluse, belonging to a
// family) are shown apart from ordinary personality. Pure presentation grouping of authored
// sandbox data; it adds no fields to any schema and invents no tags.

export type SpecialTagKind = "leader" | "recluse" | "family-oriented" | "parent" | "child";

export type SpecialTag = { kind: SpecialTagKind; label: string; meaning: string };

/** The three personality categories of docs/BLOBS.md; each has a low and a high tag. */
export type PersonalityCategory = "credulity" | "socialness" | "persuasiveness";

export type PersonalityTag = { trait: Trait; category: PersonalityCategory; meaning: string };

const CATEGORY: Partial<Record<Trait, PersonalityCategory>> = {
  skeptic: "credulity",
  gullible: "credulity",
  quiet: "socialness",
  chatty: "socialness",
  unconvincing: "persuasiveness",
  charismatic: "persuasiveness",
};

const CATEGORY_ORDER: PersonalityCategory[] = ["credulity", "socialness", "persuasiveness"];

/**
 * The special tags to show, in a fixed order: Leader, Recluse, Family-oriented, then Parent and
 * Child. Parent and Child come from the profile's relationship ids, never from its age, and
 * `family-oriented` comes only from the trait.
 */
export function specialTags(
  profile: Pick<BlobProfile, "traits" | "parentIds" | "childIds">,
): SpecialTag[] {
  const has = (trait: Trait) => profile.traits.includes(trait);
  const tags: SpecialTag[] = [];
  if (has("leader")) tags.push({ kind: "leader", label: "Leader", meaning: MEANING.leader });
  if (has("recluse")) tags.push({ kind: "recluse", label: "Recluse", meaning: MEANING.recluse });
  if (has("family-oriented")) {
    tags.push({
      kind: "family-oriented",
      label: "Family-oriented",
      meaning: MEANING["family-oriented"],
    });
  }
  if (profile.childIds.length > 0) {
    tags.push({ kind: "parent", label: "Parent", meaning: "Has a child" });
  }
  if (profile.parentIds.length > 0) {
    tags.push({ kind: "child", label: "Child", meaning: "Has a parent" });
  }
  return tags;
}

/** The ordinary personality tags, grouped by category (credulity, socialness, persuasiveness). */
export function personalityTags(profile: Pick<BlobProfile, "traits">): PersonalityTag[] {
  const tags: PersonalityTag[] = [];
  for (const trait of profile.traits) {
    const category = CATEGORY[trait];
    if (category && !tags.some((t) => t.trait === trait)) {
      tags.push({ trait, category, meaning: MEANING[trait] });
    }
  }
  return tags.sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
}

/** Both groups at once. Every trait lands in exactly one: special tags, or personality. */
export function groupTraits(profile: Pick<BlobProfile, "traits" | "parentIds" | "childIds">) {
  return { special: specialTags(profile), personality: personalityTags(profile) };
}

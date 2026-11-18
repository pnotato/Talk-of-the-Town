import type { Shape } from "../scene/blobGeometry.ts";
import { MOODS, type Mood, moodFor } from "../scene/blobMood.ts";
import { SCENARIOS } from "../scene/blobScenarios.ts";
import { shapesFixture } from "../scene/shapesFixture.ts";
import { MOOD_ROW_SHAPE } from "../scene/shapesLayout.ts";

// Profiles for the Shapes sandbox. There is no population or RunLog on this branch yet, so
// everything here is explicit, hand-authored DEMO data keyed by the scene's blob ids. It is
// deterministic, fictional, and never presented as live. Nothing is inferred from age: the
// family links below are written out.
//
// Scores are fixed, authored values. Nothing here or in the inspector computes a score, or swaps
// one in, from a mood or from what the scene is doing: the scene's moods and activities are a
// separate animated demo with no numerical outcomes.

/** Shown wherever a profile's numbers appear, so demo data can't pass for a live run. */
export const PROFILE_SOURCE = "Sandbox profile";
export const PROFILE_NOTE = "Demo data · no live run";

export type Trait =
  | "skeptic"
  | "gullible"
  | "quiet"
  | "chatty"
  | "unconvincing"
  | "charismatic"
  | "family-oriented"
  | "recluse"
  | "leader";

/** One line each, from docs/BLOBS.md, for tooltips and assistive text. */
export const TRAIT_MEANING: Record<Trait, string> = {
  skeptic: "Hard to convince",
  gullible: "Believes easily",
  quiet: "Rarely passes things on",
  chatty: "Often passes things on",
  unconvincing: "Others rarely believe them",
  charismatic: "Others tend to believe them",
  "family-oriented": "Belongs to a family",
  recluse: "Stays home; social media only",
  leader: "The shape's opinion leader",
};

export type ProfileGroup = "shapes" | "moods" | "scenes";

export type BlobProfile = {
  id: number;
  /** Fictional, unique. */
  name: string;
  shape: Shape;
  age: number;
  traits: Trait[];
  /** Demo scores, 0–100. */
  perception: number;
  interest: number;
  /** The face those scores give at rest, for before the scene reports a mood. */
  mood: Mood;
  group: ProfileGroup;
  /** Where the blob stands in the sandbox, for the picker, e.g. "Talking scene". */
  place: string;
  parentIds: number[];
  childIds: number[];
};

type Authored = { name: string; traits: Trait[]; perception: number; interest: number };

// The 18 shape-grid blobs (ids 1–18, scene order: a child, an adult and an elder per shape). The
// scene draws them smiling, so every authored perception sits in the "smile" band. In each shape
// the adult is the parent of the child, and the elder isn't in that family. All of this is
// authored, not derived from ages.
const GRID: Record<number, Authored> = {
  1: { name: "Pip Biscuit", traits: ["family-oriented", "gullible"], perception: 66, interest: 28 },
  2: {
    name: "Dana Biscuit",
    traits: ["family-oriented", "charismatic", "leader"],
    perception: 82,
    interest: 64,
  },
  3: { name: "Walt Crumpet", traits: ["skeptic", "quiet"], perception: 64, interest: 18 },
  4: { name: "Tilly Marble", traits: ["family-oriented", "chatty"], perception: 71, interest: 46 },
  5: {
    name: "Rosa Marble",
    traits: ["family-oriented", "charismatic", "leader"],
    perception: 77,
    interest: 58,
  },
  6: { name: "Otis Pebble", traits: ["gullible", "unconvincing"], perception: 88, interest: 36 },
  7: { name: "Kit Nettle", traits: ["family-oriented", "quiet"], perception: 63, interest: 22 },
  8: {
    name: "Mara Nettle",
    traits: ["family-oriented", "charismatic", "leader"],
    perception: 74,
    interest: 52,
  },
  9: { name: "Gus Thistle", traits: ["skeptic", "recluse"], perception: 62, interest: 12 },
  10: {
    name: "Nova Sprocket",
    traits: ["family-oriented", "chatty"],
    perception: 69,
    interest: 57,
  },
  11: {
    name: "Lena Sprocket",
    traits: ["family-oriented", "charismatic", "leader"],
    perception: 86,
    interest: 72,
  },
  12: { name: "Hugo Lantern", traits: ["quiet", "unconvincing"], perception: 65, interest: 20 },
  13: { name: "Dot Wobble", traits: ["family-oriented", "gullible"], perception: 73, interest: 41 },
  14: {
    name: "Ines Wobble",
    traits: ["family-oriented", "charismatic", "leader"],
    perception: 79,
    interest: 60,
  },
  15: { name: "Ada Puddle", traits: ["skeptic", "chatty"], perception: 68, interest: 33 },
  16: { name: "Ravi Button", traits: ["family-oriented", "quiet"], perception: 64, interest: 25 },
  17: {
    name: "Nell Button",
    traits: ["family-oriented", "charismatic", "leader"],
    perception: 81,
    interest: 66,
  },
  18: { name: "Sol Teacup", traits: ["gullible", "quiet"], perception: 90, interest: 30 },
};

/** Authored parent → children links for the grid. */
const GRID_FAMILIES: { parent: number; children: number[] }[] = [
  { parent: 2, children: [1] },
  { parent: 5, children: [4] },
  { parent: 8, children: [7] },
  { parent: 11, children: [10] },
  { parent: 14, children: [13] },
  { parent: 17, children: [16] },
];

// The mood row (ids 100 + the mood's index in MOODS). Each pair is written out, and gives the face
// the scene draws the blob with; the tests check that they agree.
const MOOD_ROW: Record<Mood, Authored> = {
  smile: { name: "Ollie Sunbeam", traits: ["chatty"], perception: 80, interest: 50 },
  sleepy: { name: "Nina Dozey", traits: ["quiet"], perception: 50, interest: 8 },
  flat: { name: "Flo Plain", traits: ["unconvincing"], perception: 50, interest: 40 },
  o: { name: "Ozzie Gasp", traits: ["gullible", "chatty"], perception: 50, interest: 80 },
  frown: { name: "Frankie Glum", traits: ["skeptic"], perception: 30, interest: 30 },
  worried: { name: "Wren Fretwell", traits: ["skeptic", "chatty"], perception: 30, interest: 65 },
  angry: { name: "Rex Thundercloud", traits: ["skeptic", "recluse"], perception: 10, interest: 40 },
};

// Scene actors (id 200 + 10 × the scene's index + the actor's index). The scores are fixed, and
// give the face the actor starts its scene with. The scene then plays its own scripted moods,
// which change no score.
const SCENE_ACTORS: Record<number, Authored> = {
  200: { name: "Tobi Tattle", traits: ["chatty", "charismatic"], perception: 78, interest: 62 },
  201: { name: "Cleo Marlin", traits: ["gullible", "quiet"], perception: 48, interest: 38 },
  210: { name: "Brick Stubbs", traits: ["skeptic", "unconvincing"], perception: 44, interest: 40 },
  211: { name: "Astra Hardhead", traits: ["skeptic", "charismatic"], perception: 52, interest: 45 },
  220: { name: "Kai Scroll", traits: ["chatty", "recluse"], perception: 50, interest: 35 },
  230: { name: "Drew Dribble", traits: ["chatty", "gullible"], perception: 72, interest: 55 },
};

function make(
  id: number,
  authored: Authored,
  fixed: { shape: Shape; age: number; group: ProfileGroup; place: string },
): BlobProfile {
  const { name, traits, perception, interest } = authored;
  return {
    id,
    name,
    traits,
    perception,
    interest,
    mood: moodFor(perception, interest),
    parentIds: [],
    childIds: [],
    ...fixed,
  };
}

function build(): BlobProfile[] {
  const profiles: BlobProfile[] = [];

  for (const { id, shape, age } of shapesFixture) {
    profiles.push(make(id, GRID[id], { shape, age, group: "shapes", place: "Shapes grid" }));
  }
  MOODS.forEach((mood, i) => {
    profiles.push(
      make(100 + i, MOOD_ROW[mood], {
        shape: MOOD_ROW_SHAPE,
        age: 35,
        group: "moods",
        place: "Mood row",
      }),
    );
  });
  SCENARIOS.forEach((scenario, i) => {
    scenario.actors.forEach((actor, j) => {
      const id = 200 + 10 * i + j;
      const place = `${scenario.title} scene`;
      const { shape, age } = actor;
      profiles.push(make(id, SCENE_ACTORS[id], { shape, age, group: "scenes", place }));
    });
  });

  const byId = new Map(profiles.map((p) => [p.id, p]));
  for (const { parent, children } of GRID_FAMILIES) {
    byId.get(parent)!.childIds.push(...children);
    for (const child of children) byId.get(child)!.parentIds.push(parent);
  }
  return profiles;
}

/** Every blob in the sandbox, in picker order: grid, then mood row, then scenes. */
export const PROFILES: readonly BlobProfile[] = build();

const BY_ID: ReadonlyMap<number, BlobProfile> = new Map(PROFILES.map((p) => [p.id, p]));

export function getProfile(id: number): BlobProfile | undefined {
  return BY_ID.get(id);
}

export const PROFILE_ORDER: readonly number[] = PROFILES.map((p) => p.id);

export const GROUP_TITLES: Record<ProfileGroup, string> = {
  shapes: "Shapes grid",
  moods: "Mood row",
  scenes: "Scenes",
};

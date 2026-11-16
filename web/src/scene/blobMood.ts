// A blob's mood: what its face and body colour show about its scores. Pure data and maths, so the
// scene and the tests share it.

/** Happiest first. */
export const MOODS = ["smile", "sleepy", "flat", "o", "frown", "worried", "angry"] as const;

export type Mood = (typeof MOODS)[number];

// Body colour per mood, sampled from the lit top faces of the coloured cubes in docs/blobs.png.
// The canvas renders without tone mapping, so a lit top face shows exactly these colours.
export const MOOD_COLOR: Record<Mood, string> = {
  smile: "#c8af56",
  sleepy: "#6ba676",
  flat: "#a2a099",
  o: "#c28141",
  frown: "#4879b3",
  worried: "#805cad",
  angry: "#ae3935",
};

/** A few words on what each mood says about the blob, for labels. */
export const MOOD_MEANING: Record<Mood, string> = {
  smile: "likes the company",
  sleepy: "undecided, doesn't care",
  flat: "undecided",
  o: "undecided, intrigued",
  frown: "doubts the company",
  worried: "doubts it, and cares",
  angry: "angry at the company",
};

export type EyeStyle = "open" | "shut";
export type BrowStyle = "worried" | "angry";
export type Mouth = "smile" | "line" | "o" | "frown";

/**
 * The face each mood wears. Colour is never the only cue: every mood has its own face, so moods
 * still read in greyscale and for colour-blind players.
 */
export const MOOD_FACE: Record<Mood, { eyes: EyeStyle; brows?: BrowStyle; mouth: Mouth }> = {
  smile: { eyes: "open", mouth: "smile" },
  sleepy: { eyes: "shut", mouth: "smile" },
  flat: { eyes: "open", mouth: "line" },
  o: { eyes: "open", mouth: "o" },
  frown: { eyes: "open", mouth: "frown" },
  worried: { eyes: "open", brows: "worried", mouth: "frown" },
  angry: { eyes: "open", brows: "angry", mouth: "line" },
};

/**
 * The one place that turns a blob's perception and interest (0–100) into a mood. Perception picks
 * the band: likes the company, undecided, doubts it, or angry. Interest picks within a band:
 * undecided blobs who don't care doze off and ones who care a lot look intrigued; doubters who
 * care look worried.
 *
 * DRAFT for design review: the band edges (62, 38, 20 on perception; 15, 70 and 50 on interest)
 * are placeholders carried over from the prototype, not calibrated against runs.
 */
export function moodFor(perception: number, interest: number): Mood {
  if (perception >= 62) return "smile";
  if (perception >= 38) return interest < 15 ? "sleepy" : interest >= 70 ? "o" : "flat";
  if (perception >= 20) return interest >= 50 ? "worried" : "frown";
  return "angry";
}

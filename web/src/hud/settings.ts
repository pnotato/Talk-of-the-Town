// The game's run settings: which map the run walks and how fast the replay plays.

export type MapName = "city" | "town" | "harbour";

export const MAPS: readonly { id: MapName; label: string }[] = [
  { id: "city", label: "City" },
  { id: "town", label: "Town" },
  { id: "harbour", label: "Harbour" },
];

export const SPEEDS = [1, 2, 4] as const;

/** The speed after `speed`, wrapping round to the first; an unknown speed starts over. */
export function nextSpeed(speed: number): number {
  const at = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
  return SPEEDS[(at + 1) % SPEEDS.length];
}

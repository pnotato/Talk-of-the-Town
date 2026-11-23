// The HUD's colour themes, and which one a visitor starts in. The choice is a per-viewer
// convenience: it lives in this browser only, and the page looks right without it.

export type ThemeName = "sherbet" | "midnight" | "tabloid" | "matcha";

/** Every theme, in the order the settings offer them. index.css holds each one's tokens. */
export const THEMES: readonly { id: ThemeName; label: string }[] = [
  { id: "sherbet", label: "Sherbet" },
  { id: "midnight", label: "Midnight" },
  { id: "tabloid", label: "Tabloid" },
  { id: "matcha", label: "Matcha" },
];

const DEFAULT: ThemeName = "sherbet";
const STORAGE_KEY = "tot-theme";

export function isThemeName(value: unknown): value is ThemeName {
  return THEMES.some((t) => t.id === value);
}

/** The theme to start in: the one chosen last time, else Midnight on a dark system, else Sherbet. */
export function startingTheme(saved: string | null | undefined, prefersDark: boolean): ThemeName {
  if (isThemeName(saved)) return saved;
  return prefersDark ? "midnight" : DEFAULT;
}

/** The theme the page is wearing. */
export function currentTheme(): ThemeName {
  const theme = document.documentElement.dataset.theme;
  return isThemeName(theme) ? theme : DEFAULT;
}

/** Dresses the page in `theme`; with `remember`, keeps the choice for next time if storage allows. */
export function applyTheme(theme: ThemeName, remember = false) {
  document.documentElement.dataset.theme = theme;
  if (!remember) return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage is blocked (a private window, say): the theme lasts until the page closes.
  }
}

/** The radius of a circle centred on (x, y) that just covers a width × height window. */
export function revealRadius(x: number, y: number, width: number, height: number): number {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
}

/** Puts on the starting theme. Called once, before the first render, so nothing flashes. */
export function applyStartingTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // As above: no saved choice to read.
  }
  applyTheme(startingTheme(saved, matchMedia("(prefers-color-scheme: dark)").matches));
}

// How much of the scene's view the inspector covers, for the camera to keep a focused blob clear
// of it. Pure maths on measured numbers (pixels), so the tests can check it without a browser.

/** Space to keep clear at the edges of the scene's view, in pixels. */
export type FocusInset = { top: number; bottom: number };

/**
 * The top inset: the app shell (SIMULATED badge, status and nav) down to just below it. A little
 * less than the inspector dock's own 128px clearance, which has breathing room the camera doesn't
 * need.
 */
export const FOCUS_INSET_TOP = 112;

/**
 * The inset for the inspector as it is drawn now. `barTop` is the top of the always-present bar,
 * `panelHeight` the height of the card or list above it (null when there is neither), and `gap`
 * the space between them. All of `parentBottom` and `barTop` are in the same coordinates (page
 * pixels). The bottom inset is how far the topmost thing, the panel or else the bar, rises above the
 * bottom of the parent the scene fills.
 */
export function focusInset(
  parentBottom: number,
  barTop: number,
  panelHeight: number | null,
  gap: number,
): FocusInset {
  const top = panelHeight === null ? barTop : barTop - gap - panelHeight;
  return { top: FOCUS_INSET_TOP, bottom: Math.max(0, Math.round(parentBottom - top)) };
}

export function sameInset(a: FocusInset, b: FocusInset): boolean {
  return a.top === b.top && a.bottom === b.bottom;
}

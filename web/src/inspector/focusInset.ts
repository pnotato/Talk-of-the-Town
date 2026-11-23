// How much of the scene's view the inspector covers, for the camera to keep a focused blob clear
// of it. Pure maths on measured numbers (pixels), so the tests can check it without a browser.

/** Space to keep clear at the edges of the scene's view, in pixels. */
export type FocusInset = { top: number; bottom: number };

/**
 * The top inset: breathing room below the stage's top edge, so a focused blob never crowds the
 * window's edge. It also clears the sandbox bar floating at the top of the Shapes sandbox.
 */
export const FOCUS_INSET_TOP = 64;

/**
 * The top clearance for a stage of the given height. Short landscape stages trade some of the fixed
 * 64px breathing room for usable scene space; the value never drops below 16px.
 */
export function focusInsetTop(stageHeight: number) {
  if (!Number.isFinite(stageHeight) || stageHeight <= 0) return FOCUS_INSET_TOP;
  return Math.round(Math.min(FOCUS_INSET_TOP, Math.max(16, stageHeight * 0.12)));
}

/**
 * The inset for the inspector as it is drawn now. `barTop` is the top of the always-present bar,
 * `panelHeight` the height of the card or list above it (null when there is neither), and `gap`
 * the space between them. `parentBottom` and `barTop` are in the same coordinates (page pixels).
 * The bottom inset is how far the topmost thing, the panel or else the bar, rises above the bottom
 * of the parent. `parentHeight` is the stage's height, used to shrink the top clearance on short
 * screens; omit it to use the fixed generous default.
 */
export function focusInset(
  parentBottom: number,
  barTop: number,
  panelHeight: number | null,
  gap: number,
  parentHeight?: number,
): FocusInset {
  const top = panelHeight === null ? barTop : barTop - gap - panelHeight;
  return {
    top: focusInsetTop(parentHeight ?? 0),
    bottom: Math.max(0, Math.round(parentBottom - top)),
  };
}

export function sameInset(a: FocusInset, b: FocusInset): boolean {
  return a.top === b.top && a.bottom === b.bottom;
}

// Bound fragment work even on native-DPR-1 4K displays, not just retina screens.
export const MAX_RENDER_PIXELS = 2560 * 1440;

export function renderDpr(width: number, height: number, deviceDpr: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }
  const nativeDpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  return Math.min(nativeDpr, 2, Math.sqrt(MAX_RENDER_PIXELS / (width * height)));
}

/** Re-arm the resolution query after each change so moving between displays keeps working. */
export function subscribeToDevicePixelRatio(
  onChange: () => void,
  browser: Pick<Window, "devicePixelRatio" | "matchMedia"> = window,
): () => void {
  let query = browser.matchMedia(`(resolution: ${browser.devicePixelRatio}dppx)`);
  const changed = () => {
    query.removeEventListener("change", changed);
    query = browser.matchMedia(`(resolution: ${browser.devicePixelRatio}dppx)`);
    query.addEventListener("change", changed);
    onChange();
  };
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

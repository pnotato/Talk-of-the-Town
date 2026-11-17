import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { renderDpr, subscribeToDevicePixelRatio } from "./renderResolution.ts";

const devicePixelRatio = () => window.devicePixelRatio;

/** Caps only the 3D drawing buffer; DOM labels and controls keep their native resolution. */
export function RenderResolution() {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const setDpr = useThree((s) => s.setDpr);
  const currentDpr = useThree((s) => s.viewport.dpr);
  const nativeDpr = useSyncExternalStore(subscribeToDevicePixelRatio, devicePixelRatio);
  const dpr = renderDpr(width, height, nativeDpr);

  // Canvas reconfiguration can restore its initial DPR on resize or a parent render.
  useLayoutEffect(() => {
    if (currentDpr !== dpr) setDpr(dpr);
  }, [currentDpr, dpr, setDpr]);

  return null;
}

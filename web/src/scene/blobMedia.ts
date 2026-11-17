import { useSyncExternalStore } from "react";

/** A CSS media query as an external store, for useSyncExternalStore. */
export function mediaQuery(query: string) {
  const list = matchMedia(query);
  return {
    subscribe(onChange: () => void) {
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    matches: () => list.matches,
  };
}

const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");

/** Whether the player asked for less motion. Faces and colours still change; movement stops. */
export function useReducedMotion() {
  return useSyncExternalStore(reducedMotion.subscribe, reducedMotion.matches);
}

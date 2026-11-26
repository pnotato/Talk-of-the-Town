// Clicking the harbour's toys: the ferris wheel, the carousel, the lighthouse, the bell, the kites
// and the sailboats. Each answers a click with a go that rises, holds and settles (toyBoost).
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useId, useMemo, useRef } from "react";
import { gestureFor, setHover } from "./blobPicking.ts";
import { restartBoost, toyBoost } from "./harbourMotion.ts";

/** When something last startled the gulls, in clock seconds: a firework, or the lighthouse's horn. */
export type Startle = RefObject<number>;

export interface Toy {
  /** Pointer handlers for the toy's group; none while the toy is still. */
  handlers: {
    onClick?: (event: ThreeEvent<MouseEvent>) => void;
    onPointerOver?: (event: ThreeEvent<PointerEvent>) => void;
    onPointerOut?: () => void;
  };
  /** How hard it is going at clock time `now`: 0 at rest, 1 flat out. */
  boost(now: number): number;
  /** Seconds since its current go began at clock time `now`; Infinity at rest. */
  since(now: number): number;
}

/**
 * A toy the player can set going for `duration` seconds by clicking it. A drag that ends over it
 * is not a click. A click while it is going carries on from where it is, or, if `retrigger` is
 * false (a boat partway round its lap), is ignored. Clicks on a toy stop there, so they never
 * reach the water behind it. `enabled` false (reduced motion) leaves it still and unclickable.
 */
export function useToy(duration: number, enabled = true, rise = 0.5, retrigger = true): Toy {
  const canvas = useThree((s) => s.gl.domElement);
  const clock = useThree((s) => s.clock);
  const owner = useId();
  const startedAt = useRef(-Infinity);

  useEffect(() => {
    if (!enabled) return;
    // Watch gestures before the first press: a click can only be judged by what led to it.
    gestureFor(canvas);
    return () => setHover(canvas, owner, false);
  }, [canvas, owner, enabled]);

  return useMemo((): Toy => {
    const since = (now: number) => now - startedAt.current;
    return {
      handlers: enabled
        ? {
            onClick(event) {
              event.stopPropagation();
              if (!gestureFor(canvas).isClick(event.delta)) return;
              const now = clock.elapsedTime;
              if (!retrigger && since(now) < duration) return;
              startedAt.current = now - restartBoost(since(now), duration, rise);
            },
            onPointerOver(event) {
              event.stopPropagation();
              setHover(canvas, owner, true);
            },
            onPointerOut() {
              setHover(canvas, owner, false);
            },
          }
        : {},
      boost: (now) => (enabled ? toyBoost(since(now), duration, rise) : 0),
      since,
    };
  }, [canvas, clock, owner, enabled, duration, rise, retrigger]);
}

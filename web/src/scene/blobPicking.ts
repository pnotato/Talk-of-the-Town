// Picking blobs with the pointer: telling a click from a drag, and showing the pointer cursor over
// anything clickable. Plain functions and objects, so the tests can reach them.

/**
 * How far (in CSS pixels) a pointer may stray from where it went down and still count as a click.
 * Orbit and pan drags go further; a little hand or finger jitter doesn't.
 */
export const CLICK_SLOP = 6;

/** Whether a press and release `delta` pixels apart is a click rather than a drag. */
export function isClick(delta: number) {
  return delta <= CLICK_SLOP;
}

/** The parts of a pointer event the gesture tracker reads. */
export type PointerSample = {
  pointerId: number;
  clientX: number;
  clientY: number;
  isPrimary: boolean;
};

export type GestureTracker = {
  down(pointer: PointerSample): void;
  move(pointer: PointerSample): void;
  up(pointer: PointerSample): void;
  cancel(pointer: PointerSample): void;
  /** Whether the current (or just ended) gesture went further than the slop or used two fingers. */
  readonly dragged: boolean;
  /** Whether a click that arrives now, with the pointer `delta` pixels from where it went down, is a real one. */
  isClick(delta: number): boolean;
};

/**
 * Remembers whether a gesture was ever a drag. A click event only knows how far its pointer ended
 * from where it started, so a drag that comes back to its start (an orbit there and back) would
 * look like a click. This tracks the furthest each pointer strays instead, and the verdict stays
 * until the next gesture starts, so it is still there when the click event arrives after release.
 *
 * A gesture is a drag once any pointer strays further than `slop`, a second pointer joins (pinch
 * or two-finger pan), or the browser cancels it. A primary pointer going down always starts a fresh
 * gesture, which also clears pointers whose release was never seen.
 */
export function createGestureTracker(slop = CLICK_SLOP): GestureTracker {
  const down = new Map<number, { x: number; y: number }>();
  let dragged = false;
  return {
    down({ pointerId, clientX, clientY, isPrimary }) {
      if (isPrimary) {
        down.clear();
        dragged = false;
      }
      down.set(pointerId, { x: clientX, y: clientY });
      if (down.size > 1 || !isPrimary) dragged = true;
    },
    move({ pointerId, clientX, clientY }) {
      const start = down.get(pointerId);
      if (start && Math.hypot(clientX - start.x, clientY - start.y) > slop) dragged = true;
    },
    up({ pointerId }) {
      down.delete(pointerId);
    },
    cancel({ pointerId }) {
      down.delete(pointerId);
      dragged = true;
    },
    get dragged() {
      return dragged;
    },
    isClick(delta) {
      return !dragged && delta <= slop;
    },
  };
}

const trackers = new WeakMap<EventTarget, GestureTracker>();

/**
 * The one gesture tracker for a canvas, shared by everything in its scene and made on first use. It
 * listens on the canvas in the capture phase, so it has seen a pointer event before orbit controls
 * or the scene's own handlers do. Listeners live as long as the canvas element, which is thrown away
 * with its Canvas, so there is nothing to clean up.
 */
export function gestureFor(canvas: EventTarget): GestureTracker {
  let tracker = trackers.get(canvas);
  if (!tracker) {
    const created = createGestureTracker();
    const listen = (type: string, handler: (pointer: PointerSample) => void) =>
      canvas.addEventListener(type, (event) => handler(event as unknown as PointerSample), {
        capture: true,
        passive: true,
      });
    listen("pointerdown", created.down);
    listen("pointermove", created.move);
    listen("pointerup", created.up);
    listen("pointercancel", created.cancel);
    trackers.set(canvas, (tracker = created));
  }
  return tracker;
}

type Cursorable = { style: { cursor: string } };

// Who is under the pointer, per element. Blobs overlap on screen, so one pointer can leave one blob
// and enter another in either order; tracking owners instead of flipping the cursor keeps it right.
const hovers = new WeakMap<Cursorable, Set<string>>();

/** Marks `owner` as under (or no longer under) the pointer and updates the element's cursor. */
export function setHover(element: Cursorable, owner: string, hovered: boolean) {
  let owners = hovers.get(element);
  if (!owners) hovers.set(element, (owners = new Set()));
  if (hovered) owners.add(owner);
  else owners.delete(owner);
  element.style.cursor = owners.size > 0 ? "pointer" : "";
}

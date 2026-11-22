import { MathUtils } from "three";

// Flying the Shapes camera to a blob: where to look, how close to stand, where on screen the blob
// should land so the HUD doesn't cover it, and the one-shot tween between the old view and the new.
// Plain numbers and objects created once and updated in place, so a frame allocates nothing.

/** The name of a blob's root object in the scene, so the camera can find the mounted blob. */
export const blobObjectName = (id: number) => `blob-${id}`;

// Focus stands this close at the nearest: enough to see the blob and its neighbours, not so close
// that the overview is lost. A narrow screen stands further back to keep the neighbours in view.
const NEIGHBOURHOOD_MIN = 10;
const NEIGHBOURHOOD_MAX = 18;
// Half the width of ground the focused view aims to show.
const NEIGHBOURHOOD_HALF_WIDTH = 3.6;

/**
 * How far from a blob the camera stands to see its neighbourhood, for a vertical field of view of
 * `fov` degrees and a canvas of the given width over height.
 */
export function neighbourhoodDistance(fov: number, aspect: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const tanH = Math.tan(MathUtils.degToRad(fov / 2)) * safeAspect;
  return MathUtils.clamp(NEIGHBOURHOOD_HALF_WIDTH / tanH, NEIGHBOURHOOD_MIN, NEIGHBOURHOOD_MAX);
}

/**
 * The distance to fly to: the neighbourhood distance if the camera is further out than that, else
 * where it already is, so focusing zooms in gently. If the blob would not fit the clear band of
 * the canvas from there (`fit`, from fitBlobDistance), it stands back to that distance instead.
 * Always within the controls' range, which wins if the two disagree.
 */
export function focusDistance(
  current: number,
  neighbourhood: number,
  fit: number,
  min: number,
  max: number,
) {
  return MathUtils.clamp(Math.max(Math.min(current, neighbourhood), fit), min, max);
}

/** Screen space (CSS pixels) the HUD takes from the top and bottom of the canvas. */
export type Inset = { top: number; bottom: number };

// The stage's own top edge, used only when the page doesn't report a measured inset.
const SHELL = 64;

/**
 * A guess at how much of the canvas the inspector covers, for when the page doesn't say: a dock of
 * about 300px along the bottom on a wide screen, and a taller panel on a tall one.
 */
export function defaultInset(width: number, height: number): Inset {
  const bottom = width < height ? 0.5 * height : MathUtils.clamp(0.33 * height, 180, 320);
  return { top: SHELL, bottom };
}

/** What the page reported (any part may be missing) over the guess, with bad numbers set to 0. */
export function resolveInset(width: number, height: number, reported?: Partial<Inset>): Inset {
  const guess = defaultInset(width, height);
  const finite = (value: number | undefined, fallback: number) =>
    value === undefined ? fallback : Number.isFinite(value) ? Math.max(0, value) : 0;
  return { top: finite(reported?.top, guess.top), bottom: finite(reported?.bottom, guess.bottom) };
}

// The least band, in pixels, left clear when the reported insets overlap or fill the canvas.
const MIN_BAND = 1;

/**
 * The insets to aim by: exactly as reported whenever they leave any clear band at all, however thin.
 * Only invalid insets are changed: negative or oversized ones are clamped to the canvas, and ones
 * that overlap or fill it are cut back, the bottom first and then the top, to leave a band of 1px.
 * Whatever space is really clear is never second-guessed, so the aim never lands behind the HUD.
 */
export function safeInset(height: number, { top, bottom }: Inset): Inset {
  let [t, b] = [MathUtils.clamp(top, 0, height), MathUtils.clamp(bottom, 0, height)];
  const band = Math.min(MIN_BAND, height);
  let short = band - (height - t - b);
  if (short > 0) {
    const fromBottom = Math.min(b, short);
    b -= fromBottom;
    short -= fromBottom;
    t -= Math.min(t, short);
  }
  return { top: t, bottom: b };
}

/** The height (CSS pixels) of the canvas left clear between the safe insets. */
export function clearBand(height: number, inset: Inset) {
  const { top, bottom } = safeInset(height, inset);
  return height - top - bottom;
}

/**
 * How far (CSS pixels) to shift the picture up so that what is at the centre of the camera lands in
 * the middle of the clear band between the HUD's insets, so the aim is never behind the HUD. Never
 * shifts down: the stage's top edge already frames the scene.
 */
export function viewShift(height: number, inset: Inset) {
  const { top, bottom } = safeInset(height, inset);
  return Math.max(0, (bottom - top) / 2);
}

// How much of the clear band a focused blob may fill, root to head, so it isn't touching the HUD.
const BAND_FILL = 0.8;

/**
 * How far the camera must stand from a blob for the blob to fit in the clear band: `height` and
 * `radius` are the blob's height and footprint radius in world units, `elevation` (radians) the angle
 * the camera looks down at, and `fov` the vertical field of view in degrees. A vertical stretch of
 * `height` shows at cos(elevation) of its length, and the footprint adds sin(elevation) of its width.
 */
export function fitBlobDistance(
  height: number,
  radius: number,
  elevation: number,
  fov: number,
  canvasHeight: number,
  band: number,
) {
  const shown = height * Math.cos(elevation) + 2 * radius * Math.sin(elevation);
  const tan = Math.tan(MathUtils.degToRad(fov / 2));
  return (shown * canvasHeight) / (2 * tan * Math.max(band, 1) * BAND_FILL);
}

/** Where the camera looks, how far from that point it stands, and the screen shift in pixels. */
export type Pose = { x: number; y: number; z: number; distance: number; shift: number };

export type Flight = {
  active: boolean;
  elapsed: number;
  duration: number;
  from: Pose;
  to: Pose;
  /** Unit vector from the target to the camera, held for the whole flight so the angle never changes. */
  dx: number;
  dy: number;
  dz: number;
};

const pose = (): Pose => ({ x: 0, y: 0, z: 0, distance: 0, shift: 0 });

export function createFlight(): Flight {
  return { active: false, elapsed: 0, duration: 1, from: pose(), to: pose(), dx: 0, dy: 1, dz: 0 };
}

const MIN_DURATION = 0.6;
const MAX_DURATION = 1.3;

/** Seconds a flight takes: longer for a longer trip, between 0.6 and 1.3. */
export function flightDuration(travel: number, zoom: number) {
  return MathUtils.clamp(0.55 + 0.04 * travel + 0.02 * Math.abs(zoom), MIN_DURATION, MAX_DURATION);
}

/** Slow out of the start, fast in the middle, slow into the end. */
export function ease(t: number) {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Starts (or restarts, from wherever the camera is now) a flight from `from` to `to`, keeping the
 * camera on the line `direction` from its target. `direction` need not be normalised.
 */
export function startFlight(
  flight: Flight,
  from: Pose,
  to: Pose,
  direction: { x: number; y: number; z: number },
) {
  Object.assign(flight.from, from);
  Object.assign(flight.to, to);
  const length = Math.hypot(direction.x, direction.y, direction.z);
  // A camera sitting on its target has no direction to keep: look down on it.
  flight.dx = length > 1e-9 ? direction.x / length : 0;
  flight.dy = length > 1e-9 ? direction.y / length : 1;
  flight.dz = length > 1e-9 ? direction.z / length : 0;
  const travel = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  flight.duration = flightDuration(travel, to.distance - from.distance);
  flight.elapsed = 0;
  flight.active = true;
}

/** Stops the flight where the camera is; whoever called it keeps the camera as it stands. */
export function cancelFlight(flight: Flight) {
  flight.active = false;
}

/** Writes the pose `t` (0..1 through the flight, eased) into `out`. */
function sample(flight: Flight, t: number, out: Pose) {
  const e = ease(t);
  const { from, to } = flight;
  out.x = from.x + (to.x - from.x) * e;
  out.y = from.y + (to.y - from.y) * e;
  out.z = from.z + (to.z - from.z) * e;
  out.distance = from.distance + (to.distance - from.distance) * e;
  out.shift = from.shift + (to.shift - from.shift) * e;
}

// A frame this long (a hitch, a hidden tab) counts as this much, so the flight doesn't skip ahead.
const MAX_STEP = 1 / 20;

/** Advances the flight by `delta` seconds and writes the new pose into `out`. False if idle. */
export function stepFlight(flight: Flight, delta: number, out: Pose) {
  if (!flight.active) return false;
  flight.elapsed += Math.min(Math.max(delta, 0), MAX_STEP);
  const t = flight.elapsed / flight.duration;
  sample(flight, t, out);
  if (t >= 1) flight.active = false;
  return true;
}

/** Ends the flight at once and writes where it was going into `out`; for reduced motion. */
export function finishFlight(flight: Flight, out: Pose) {
  sample(flight, 1, out);
  flight.active = false;
}

/**
 * Where a focus request is in its life, for the component that flies it. A request is `pending`
 * from the moment it arrives until it has really started (the controls exist and its blob is
 * mounted), so one that arrives early isn't lost; then it is `focused`, until something takes the
 * camera back. `seen` is the last request received, so one request is only taken up once.
 */
export type FocusSession<R> = {
  seen: R | null;
  pending: R | null;
  /** Seconds the pending request has waited to start. */
  waited: number;
  focused: boolean;
};

/** How long a pending request waits for its blob to mount before it is given up on, in seconds. */
export const GIVE_UP = 3;

export function createSession<R>(): FocusSession<R> {
  return { seen: null, pending: null, waited: 0, focused: false };
}

/**
 * Takes up the app's current request (null for none). A request not seen before becomes pending,
 * and the previous one is dropped; the same request again changes nothing, so re-renders and
 * StrictMode remounts don't restart it. Null clears everything. Returns whether the request is new.
 */
export function receive<R extends object>(session: FocusSession<R>, request: R | null) {
  if (!request) {
    Object.assign(session, { seen: null, pending: null, waited: 0, focused: false });
    return false;
  }
  if (session.seen === request) return false;
  Object.assign(session, { seen: request, pending: request, waited: 0, focused: false });
  return true;
}

/** The pending request has started flying. */
export function started<R>(session: FocusSession<R>) {
  session.pending = null;
  session.waited = 0;
  session.focused = true;
}

/** The user took the camera (or the page reframed it): nothing pending or focused any more. */
export function takenOver<R>(session: FocusSession<R>) {
  session.pending = null;
  session.focused = false;
}

/** A reframe: the focus is gone, but a request that hasn't started yet is kept. */
export function reframed<R>(session: FocusSession<R>) {
  session.focused = false;
}

/** Counts `delta` seconds of waiting. False (and the request is dropped) once it is too long. */
export function keepWaiting<R>(session: FocusSession<R>, delta: number) {
  if (!session.pending) return false;
  session.waited += delta;
  if (session.waited > GIVE_UP) {
    session.pending = null;
    return false;
  }
  return true;
}

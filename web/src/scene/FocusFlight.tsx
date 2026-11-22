import type { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { MathUtils, type PerspectiveCamera, Vector3 } from "three";
import type { BlobFocusRequest } from "../inspector/BlobSelection.tsx";
import {
  type Flight,
  type Inset,
  type Pose,
  blobObjectName,
  cancelFlight,
  clearBand,
  createFlight,
  createSession,
  finishFlight,
  fitBlobDistance,
  focusDistance,
  keepWaiting,
  neighbourhoodDistance,
  receive,
  reframed,
  resolveInset,
  started,
  startFlight,
  stepFlight,
  takenOver,
  viewShift,
} from "./blobFocus.ts";
import { useReducedMotion } from "./blobMedia.ts";
import { FOV, type View } from "./shapesLayout.ts";

type Controls = ComponentRef<typeof OrbitControls>;

// Scratch values, reused so that starting a flight and every frame of one allocate nothing.
const here = new Vector3();
const toCamera = new Vector3();
const frame: Pose = { x: 0, y: 0, z: 0, distance: 0, shift: 0 };
const start: Pose = { x: 0, y: 0, z: 0, distance: 0, shift: 0 };
const goal: Pose = { x: 0, y: 0, z: 0, distance: 0, shift: 0 };

// A blob's middle and footprint, when its root doesn't say.
const DEFAULT_FOCUS_HEIGHT = 0.45;
const DEFAULT_FOCUS_RADIUS = 0.5;

/**
 * Flies the camera to the blob a focus request names, once per request: to where the blob stands
 * when the flight starts (its mounted root, so a walker is found where it is, not where its beat
 * sends it), without chasing it afterwards. The camera keeps its angle, comes in to its
 * neighbourhood if it was further out (or stands back if the blob wouldn't fit the clear part of
 * the canvas), and shifts the picture so the blob lands in the clear band above the HUD. Reduced
 * motion snaps.
 *
 * A request waits until it can start: until the controls exist and the blob's root is mounted,
 * which may be after the request arrives (a page that asks for a focus as the canvas mounts). It is
 * retried when the controls appear and every frame after that, for a few seconds. Once it starts it
 * is remembered, so a re-render, a resize or a StrictMode remount doesn't fly it again, while a new
 * request for the same blob (a new serial) does.
 *
 * While the request stands (the user hasn't taken over, the selection hasn't moved on, the stage
 * hasn't reframed), a change to the inset or the canvas size re-aims the shift and the distance for
 * the same blob without chasing it. After that, the camera is left alone. Any grab of the controls
 * (a drag, a pan, the wheel, a touch) cancels at once; so does a request of null, and so does a
 * reframe, which also drops the shift. The shift is a camera view offset, so picking, labels and
 * orbiting all stay in step with what is drawn.
 *
 * The flight aims inside the view's content box, which the orbit target is held to, so the controls
 * never pull it back from where it was sent. `inset` is how much of the canvas the HUD covers; omit
 * a part for a guess.
 */
export default function FocusFlight({
  request,
  view,
  distance,
  inset,
}: {
  request: BlobFocusRequest | null;
  /** The framing in use: a different one means the stage reframed, which undoes any focus. */
  view: View;
  /** The overview distance for `view` at this canvas's proportions; a change also reframes. */
  distance: number;
  inset?: Partial<Inset>;
}) {
  const get = useThree((s) => s.get);
  const controls = useThree((s) => s.controls) as Controls | null;
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const reduceMotion = useReducedMotion();
  const resolved = resolveInset(size.width, size.height, inset);

  const flight = useRef<Flight>(createFlight());
  // The screen shift currently applied to the camera, in pixels.
  const shift = useRef(0);
  // Where the request is in its life: waiting to start, flying, or over.
  const session = useRef(createSession<BlobFocusRequest>());
  // The blob being focused, as measured when it started: where it stood, how tall, how wide.
  const aim = useRef({ x: 0, y: 0, z: 0, height: 1, radius: DEFAULT_FOCUS_RADIUS });
  // The inset and canvas size the current goal was made for.
  const goalKey = useRef("");
  // The newest props, for code that runs between renders.
  const latest = useRef({ content: view.content, reduceMotion, inset: resolved });
  useLayoutEffect(() => {
    latest.current.content = view.content;
    latest.current.reduceMotion = reduceMotion;
    latest.current.inset = resolved;
  });

  // Shifts the picture up by `pixels`, as a view offset the size of the canvas. Unchanged shifts are
  // skipped, so most frames do nothing.
  const applyShift = useCallback(
    (pixels: number, canvas: { width: number; height: number }, force = false) => {
      if (!force && pixels === shift.current) return;
      shift.current = pixels;
      if (pixels === 0) {
        if (camera.view?.enabled) camera.clearViewOffset();
      } else {
        camera.setViewOffset(canvas.width, canvas.height, 0, pixels, canvas.width, canvas.height);
      }
    },
    [camera],
  );

  // Flies from where the camera is to the aim, for the newest inset: the start of a request, and
  // again if the inset or the canvas changes while the request stands.
  const fly = useCallback(() => {
    const { controls, size, camera } = get();
    const orbit = controls as Controls | null;
    if (!orbit) return false;
    const { content, reduceMotion, inset } = latest.current;
    const a = aim.current;

    const { target } = orbit;
    toCamera.subVectors(camera.position, target);
    const current = toCamera.length();
    start.x = target.x;
    start.y = target.y;
    start.z = target.z;
    start.distance = current;
    start.shift = shift.current;

    goal.x = MathUtils.clamp(a.x, content.min.x, content.max.x);
    goal.y = a.y;
    goal.z = MathUtils.clamp(a.z, content.min.z, content.max.z);
    const elevation = current > 1e-9 ? Math.asin(MathUtils.clamp(toCamera.y / current, -1, 1)) : 0;
    const fit = fitBlobDistance(
      a.height,
      a.radius,
      elevation,
      FOV,
      size.height,
      clearBand(size.height, inset),
    );
    goal.distance = focusDistance(
      current,
      neighbourhoodDistance(FOV, size.width / size.height),
      fit,
      orbit.minDistance,
      orbit.maxDistance,
    );
    goal.shift = viewShift(size.height, inset);
    goalKey.current = `${inset.top},${inset.bottom},${size.width},${size.height}`;

    startFlight(flight.current, start, goal, toCamera);
    if (reduceMotion) {
      finishFlight(flight.current, frame);
      place(orbit, camera as PerspectiveCamera, flight.current, frame);
      applyShift(frame.shift, size);
    }
    return true;
  }, [get, applyShift]);

  // Starts the pending request if the controls and the blob are there. False if it must wait.
  const tryStart = useCallback(() => {
    const request = session.current.pending;
    if (!request) return false;
    const root = get().scene.getObjectByName(blobObjectName(request.id));
    if (!get().controls || !root) return false;

    root.getWorldPosition(here);
    const { focusHeight, focusRadius } = root.userData;
    const a = aim.current;
    a.x = here.x;
    a.z = here.z;
    a.y = typeof focusHeight === "number" ? focusHeight : DEFAULT_FOCUS_HEIGHT;
    a.height = 2 * a.y;
    a.radius = typeof focusRadius === "number" ? focusRadius : DEFAULT_FOCUS_RADIUS;
    if (!fly()) return false;
    started(session.current);
    return true;
  }, [get, fly]);

  // A reframe puts the camera back on the overview: no flight, no shift, nothing left to re-aim. A
  // request still waiting to start is kept: it starts from the overview.
  useLayoutEffect(() => {
    cancelFlight(flight.current);
    reframed(session.current);
    applyShift(0, get().size);
  }, [view, distance, get, applyShift]);

  // The shift is in pixels of the canvas, so keep it fitted when the canvas changes size.
  useLayoutEffect(() => {
    applyShift(shift.current, size, true);
  }, [size, applyShift]);

  // Grabbing the controls ends the flight and the request at once, whatever the gesture.
  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      cancelFlight(flight.current);
      takenOver(session.current);
    };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  // Takes up each new request, and tries again whenever the controls turn up.
  useEffect(() => {
    // A new request (or none) ends any flight in progress; tryStart then starts a new one if it can.
    if (receive(session.current, request) || !request) cancelFlight(flight.current);
    tryStart();
  }, [request, controls, tryStart]);

  // The inset is often measured a layout after the request: re-aim the same blob for it.
  const key = `${resolved.top},${resolved.bottom},${size.width},${size.height}`;
  useEffect(() => {
    if (session.current.focused && key !== goalKey.current) fly();
  }, [key, fly]);

  // Before the controls' own update (priority -1), which keeps whatever target and camera it finds.
  useFrame((state, delta) => {
    if (session.current.pending) {
      if (!tryStart()) {
        keepWaiting(session.current, delta);
        return;
      }
    }
    const f = flight.current;
    const orbit = state.controls as Controls | null;
    if (!f.active || !orbit) return;
    stepFlight(f, delta, frame);
    place(orbit, camera, f, frame);
    applyShift(frame.shift, state.size);
  }, -2);

  return null;
}

/** Puts the orbit target and the camera at `pose`, on the line the flight holds. */
function place(orbit: Controls, camera: PerspectiveCamera, f: Flight, pose: Pose) {
  orbit.target.set(pose.x, pose.y, pose.z);
  camera.position.set(
    pose.x + f.dx * pose.distance,
    pose.y + f.dy * pose.distance,
    pose.z + f.dz * pose.distance,
  );
}

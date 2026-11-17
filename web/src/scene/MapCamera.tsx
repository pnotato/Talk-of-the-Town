import { MapControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useLayoutEffect, useMemo, useRef } from "react";
import { type Camera, MathUtils, PerspectiveCamera, Spherical, Vector3 } from "three";
import { cameraFloor, type MapLayout, type Solid } from "./mapLayout.ts";

// Default look-down angle above the horizon. Portrait screens are width-bound, so a
// steeper look there spends their spare height on the town.
const LANDSCAPE_ELEVATION = MathUtils.degToRad(50);
const PORTRAIT_ELEVATION = MathUtils.degToRad(64);
const MIN_POLAR = MathUtils.degToRad(10); // nearly straight down
const LOWEST_TILT = MathUtils.degToRad(64); // default: low, but the map never turns edge-on
const ZOOM_OUT_ROOM = 1.35; // how far past the default framing the player may zoom out
const FRAME_FILL = 0.92; // share of the view the town fills by default

interface Framing {
  position: Vector3;
  target: Vector3;
  distance: number;
}

function elevationFor(aspect: number): number {
  const t = MathUtils.clamp((aspect - 0.5) / (1.2 - 0.5), 0, 1);
  return MathUtils.lerp(PORTRAIT_ELEVATION, LANDSCAPE_ELEVATION, t);
}

// Closest camera, looking north from above, whose frustum holds every point. Each side
// plane of the frustum is pushed out to its furthest point; the top/bottom pair and the
// left/right pair each meet on a line, and the camera takes whichever is further back.
function frameTown(
  points: Vector3[],
  fovDeg: number,
  aspect: number,
  targetHeight: number,
): Framing {
  const elevation = elevationFor(aspect);
  const forward = new Vector3(0, -Math.sin(elevation), -Math.cos(elevation));
  const up = new Vector3(0, Math.cos(elevation), -Math.sin(elevation));
  const right = new Vector3(1, 0, 0);
  const tanV = Math.tan(MathUtils.degToRad(fovDeg) / 2) * FRAME_FILL;
  const v = Math.atan(tanV);
  const h = Math.atan(tanV * aspect);

  // Outward normal of a side plane leaning `angle` off the view axis towards `side`.
  const plane = (side: Vector3, sign: number, angle: number) =>
    side
      .clone()
      .multiplyScalar(sign * Math.cos(angle))
      .addScaledVector(forward, -Math.sin(angle));
  const reach = (normal: Vector3) => Math.max(...points.map((p) => p.dot(normal)));
  const top = reach(plane(up, 1, v));
  const bottom = reach(plane(up, -1, v));
  const east = reach(plane(right, 1, h));
  const west = reach(plane(right, -1, h));

  const along = Math.min(-(top + bottom) / (2 * Math.sin(v)), -(east + west) / (2 * Math.sin(h)));
  const position = new Vector3()
    .addScaledVector(right, (east - west) / (2 * Math.cos(h)))
    .addScaledVector(up, (top - bottom) / (2 * Math.cos(v)))
    .addScaledVector(forward, along);
  // Orbit around the spot the camera looks at, targetHeight above the ground.
  const target = position.clone().addScaledVector(forward, (targetHeight - position.y) / forward.y);
  return { position, target, distance: position.distanceTo(target) };
}

// After the controls update (drei runs them at -1) and before the shadow fit (0).
const AFTER_CONTROLS = -0.5;

// Scratch for lifting the camera, so the frame loop allocates nothing.
const offset = new Vector3();
const spherical = new Spherical();

// Whether a camera `radius` from the target, at polar angle `phi`, is above the floor.
function clears(solids: Solid[], target: Vector3, radius: number, phi: number, theta: number) {
  const out = Math.sin(phi) * radius;
  const floor = cameraFloor(
    solids,
    target.x + out * Math.sin(theta),
    target.z + out * Math.cos(theta),
  );
  return target.y + Math.cos(phi) * radius >= floor;
}

// Lift the camera above the floor round the same target: the least steeper tilt that clears
// it, or at the steepest tilt, backing off until it does. The floor is continuous, so the
// lift is too: no pop as the camera passes a tower.
function liftAboveFloor(camera: Camera, target: Vector3, solids: Solid[]) {
  spherical.setFromVector3(offset.copy(camera.position).sub(target));
  const { theta } = spherical;
  if (clears(solids, target, spherical.radius, spherical.phi, theta)) return;
  if (clears(solids, target, spherical.radius, MIN_POLAR, theta)) {
    let lo = MIN_POLAR;
    let hi = spherical.phi;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (clears(solids, target, spherical.radius, mid, theta)) lo = mid;
      else hi = mid;
    }
    spherical.phi = lo;
  } else {
    spherical.phi = MIN_POLAR;
    for (let i = 0; i < 100; i++) {
      if (clears(solids, target, spherical.radius, MIN_POLAR, theta)) break;
      spherical.radius *= 1.05;
    }
  }
  camera.position.copy(target).add(offset.setFromSpherical(spherical));
  camera.lookAt(target);
}

interface Props {
  map: MapLayout;
  /** Closest zoom. */
  minDistance?: number;
  /** Lowest tilt, from straight down; past 90 degrees the camera looks up. */
  maxPolar?: number;
  /** Height of the point the camera orbits; above 0 it can look across, not just down. */
  targetHeight?: number;
  /** Colour the far fields fade into; the sky behind should match. */
  fogColor: string;
}

/**
 * Pan and zoom over a map, clamped so the map always stays in view, and lifted so the
 * camera never ends up inside one of the map's solids.
 */
export function MapCamera({
  map,
  minDistance = 0,
  maxPolar = LOWEST_TILT,
  targetHeight = 0,
  fogColor,
}: Props) {
  const fov = useThree((s) => (s.camera as PerspectiveCamera).fov);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const points = useMemo(() => map.frame.map((p) => new Vector3(p.x, p.y, p.z)), [map]);
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Zoom-out room follows the window, so the whole town stays reachable after a resize.
  const maxDistance = useMemo(
    () => frameTown(points, fov, aspect, targetHeight).distance * ZOOM_OUT_ROOM,
    [points, fov, aspect, targetHeight],
  );

  // Fog starts past the far side of the town even fully zoomed out, so only the fields
  // beyond it fade into the sky, on any screen.
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const ellipse = map.roam === "ellipse";
  const fogNear = maxDistance + Math.max(maxX - minX, maxZ - minZ);

  // The controls drive an unseen rig, never the camera that renders: input lands on the rig
  // whenever it comes, and the floor only lifts the rendered camera, so after a tower the
  // view settles back to the tilt and distance the player chose.
  // Pan speed follows the controlled camera's field of view, so the rig shares the real one's.
  const rig = useMemo(() => new PerspectiveCamera(fov), [fov]);

  // Frame the whole map once; resizing later keeps the player's view.
  const aspectAtMount = useRef(aspect);
  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { position, target } = frameTown(points, fov, aspectAtMount.current, targetHeight);
    c.object.position.copy(position);
    c.target.copy(target);
    c.update();
  }, [points, fov, targetHeight]);

  // Every frame, just after the controls update: clamp (their "change" event stays silent
  // for the last of the damping), then put the real camera at the rig and lift it.
  useFrame(({ camera: view }) => {
    const c = controls.current;
    if (!c) return;
    clampTarget(c.target, c.object);
    c.object.updateMatrixWorld();
    view.position.copy(c.object.position);
    view.lookAt(c.target);
    liftAboveFloor(view, c.target, map.solids);
  }, AFTER_CONTROLS);

  // Keep the orbit target over the map: inside its bounds, or inside the ellipse that fills
  // them when the map is round (its corners are empty fields). The camera moves by the same
  // amount, so the view slides to a stop at the edge instead of turning.
  function clampTarget(t: Vector3, camera: Camera) {
    let dx: number;
    let dz: number;
    if (ellipse) {
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const out = Math.hypot((t.x - cx) / ((maxX - minX) / 2), (t.z - cz) / ((maxZ - minZ) / 2));
      if (out <= 1) return;
      dx = cx + (t.x - cx) / out - t.x;
      dz = cz + (t.z - cz) / out - t.z;
    } else {
      dx = MathUtils.clamp(t.x, minX, maxX) - t.x;
      dz = MathUtils.clamp(t.z, minZ, maxZ) - t.z;
      if (dx === 0 && dz === 0) return;
    }
    t.x += dx;
    t.z += dz;
    camera.position.x += dx;
    camera.position.z += dz;
  }

  return (
    <>
      <fog attach="fog" args={[fogColor, fogNear, fogNear * 3]} />
      <MapControls
        ref={controls}
        camera={rig}
        makeDefault
        enableDamping={!reducedMotion}
        minDistance={minDistance}
        maxDistance={maxDistance}
        minPolarAngle={MIN_POLAR}
        maxPolarAngle={maxPolar}
      />
    </>
  );
}

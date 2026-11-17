import { MapControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { type ComponentRef, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { TOWN_HEIGHT, type TownLayout } from "./layoutTown.ts";

// Default look-down angle above the horizon. Portrait screens are width-bound, so a
// steeper look there spends their spare height on the town.
const LANDSCAPE_ELEVATION = MathUtils.degToRad(50);
const PORTRAIT_ELEVATION = MathUtils.degToRad(64);
const MIN_POLAR = MathUtils.degToRad(10); // nearly straight down
const MAX_POLAR = MathUtils.degToRad(64); // low, but the town never turns edge-on
// Close enough to see a doorstep; with MAX_POLAR the camera stays above every roof and tree.
const MIN_DISTANCE = 10;
const ZOOM_OUT_ROOM = 1.35; // how far past the default framing the player may zoom out
const FRAME_FILL = 0.92; // share of the view the town fills by default

interface Framing {
  position: Vector3;
  target: Vector3;
  distance: number;
}

// Points on the town's outline, at the ground and at roof height.
function outline(layout: TownLayout): Vector3[] {
  const points: Vector3[] = [];
  for (const d of [layout.square, ...layout.neighbourhoods]) {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const x = d.x + Math.cos(a) * d.radius;
      const z = d.z + Math.sin(a) * d.radius;
      points.push(new Vector3(x, 0, z), new Vector3(x, TOWN_HEIGHT, z));
    }
  }
  return points;
}

function elevationFor(aspect: number): number {
  const t = MathUtils.clamp((aspect - 0.5) / (1.2 - 0.5), 0, 1);
  return MathUtils.lerp(PORTRAIT_ELEVATION, LANDSCAPE_ELEVATION, t);
}

// Closest camera, looking north from above, whose frustum holds every point. Each side
// plane of the frustum is pushed out to its furthest point; the top/bottom pair and the
// left/right pair each meet on a line, and the camera takes whichever is further back.
function frameTown(points: Vector3[], fovDeg: number, aspect: number): Framing {
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
  // Orbit around the spot on the ground the camera looks at.
  const target = position.clone().addScaledVector(forward, -position.y / forward.y);
  return { position, target, distance: position.distanceTo(target) };
}

interface Props {
  layout: TownLayout;
  /** Colour the far fields fade into; the sky behind should match. */
  fogColor: string;
}

/** Pan and zoom over the town, clamped so the town always stays in view. */
export function TownCamera({ layout, fogColor }: Props) {
  const fov = useThree((s) => (s.camera as PerspectiveCamera).fov);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const points = useMemo(() => outline(layout), [layout]);
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Zoom-out room follows the window, so the whole town stays reachable after a resize.
  const maxDistance = useMemo(
    () => frameTown(points, fov, aspect).distance * ZOOM_OUT_ROOM,
    [points, fov, aspect],
  );

  // Fog starts past the far side of the town even fully zoomed out, so only the fields
  // beyond it fade into the sky, on any screen.
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const fogNear = maxDistance + Math.max(maxX - minX, maxZ - minZ);

  // Frame the whole town once per layout; resizing later keeps the player's view.
  const aspectAtMount = useRef(aspect);
  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { position, target } = frameTown(points, fov, aspectAtMount.current);
    c.object.position.copy(position);
    c.target.copy(target);
    c.update();
  }, [points, fov]);

  // Keep the orbit target over the town: inside the ellipse that fills the bounds, since
  // the corners of a round town's bounds are empty fields. The camera moves by the same
  // amount, so the view slides to a stop at the edge instead of turning.
  const clampTarget = useCallback(() => {
    const c = controls.current;
    if (!c) return;
    const t = c.target;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const out = Math.hypot((t.x - cx) / ((maxX - minX) / 2), (t.z - cz) / ((maxZ - minZ) / 2));
    if (out <= 1) return;
    const dx = cx + (t.x - cx) / out - t.x;
    const dz = cz + (t.z - cz) / out - t.z;
    t.x += dx;
    t.z += dz;
    c.object.position.x += dx;
    c.object.position.z += dz;
  }, [minX, maxX, minZ, maxZ]);

  return (
    <>
      <fog attach="fog" args={[fogColor, fogNear, fogNear * 3]} />
      <MapControls
        ref={controls}
        makeDefault
        onChange={clampTarget}
        enableDamping={!reducedMotion}
        minDistance={MIN_DISTANCE}
        maxDistance={maxDistance}
        minPolarAngle={MIN_POLAR}
        maxPolarAngle={MAX_POLAR}
      />
    </>
  );
}

import { MapControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { type ComponentRef, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { MapLayout } from "./mapLayout.ts";

// Default look-down angle above the horizon. Portrait screens are width-bound, so a
// steeper look there spends their spare height on the town.
const LANDSCAPE_ELEVATION = MathUtils.degToRad(50);
const PORTRAIT_ELEVATION = MathUtils.degToRad(64);
const MIN_POLAR = MathUtils.degToRad(10); // nearly straight down
const MAX_POLAR = MathUtils.degToRad(64); // low, but the map never turns edge-on
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
  map: MapLayout;
  /** Closest zoom. */
  minDistance?: number;
  /** A height the camera must stay above, even fully zoomed in at its lowest tilt. */
  clearance?: number;
  /** Colour the far fields fade into; the sky behind should match. */
  fogColor: string;
}

/** Pan and zoom over a map, clamped so the map always stays in view. */
export function MapCamera({ map, minDistance = 0, clearance = 0, fogColor }: Props) {
  const closest = Math.max(minDistance, clearance / Math.cos(MAX_POLAR));
  const fov = useThree((s) => (s.camera as PerspectiveCamera).fov);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const points = useMemo(() => map.frame.map((p) => new Vector3(p.x, p.y, p.z)), [map]);
  const reducedMotion = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Zoom-out room follows the window, so the whole town stays reachable after a resize.
  const maxDistance = useMemo(
    () => frameTown(points, fov, aspect).distance * ZOOM_OUT_ROOM,
    [points, fov, aspect],
  );

  // Fog starts past the far side of the town even fully zoomed out, so only the fields
  // beyond it fade into the sky, on any screen.
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const ellipse = map.roam === "ellipse";
  const fogNear = maxDistance + Math.max(maxX - minX, maxZ - minZ);

  // Frame the whole map once; resizing later keeps the player's view.
  const aspectAtMount = useRef(aspect);
  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { position, target } = frameTown(points, fov, aspectAtMount.current);
    c.object.position.copy(position);
    c.target.copy(target);
    c.update();
  }, [points, fov]);

  // Keep the orbit target over the map: inside its bounds, or inside the ellipse that fills
  // them when the map is round (its corners are empty fields). The camera moves by the same
  // amount, so the view slides to a stop at the edge instead of turning.
  const clampTarget = useCallback(() => {
    const c = controls.current;
    if (!c) return;
    const t = c.target;
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
    c.object.position.x += dx;
    c.object.position.z += dz;
  }, [ellipse, minX, maxX, minZ, maxZ]);

  return (
    <>
      <fog attach="fog" args={[fogColor, fogNear, fogNear * 3]} />
      <MapControls
        ref={controls}
        makeDefault
        onChange={clampTarget}
        enableDamping={!reducedMotion}
        minDistance={closest}
        maxDistance={maxDistance}
        minPolarAngle={MIN_POLAR}
        maxPolarAngle={MAX_POLAR}
      />
    </>
  );
}

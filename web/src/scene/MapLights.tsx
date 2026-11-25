import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type Camera, DirectionalLight, Matrix4, Vector3 } from "three";
import type { MapLayout } from "./mapLayout.ts";

const SKY_LIGHT = "#e3eef7";
const GROUND_LIGHT = "#8d9a78";
const SUN = "#fff3e0";
// From front-left and high, so the faces turned towards the default camera are lit and
// shadows fall back and to the right.
const SUN_DIRECTION = new Vector3(-0.55, 1.15, 0.6).normalize();
const SHADOW_MAP_SIZE = 2048;

// Shadow map axes, as the shadow camera's lookAt (up = +y) lays them out.
const SHADOW_RIGHT = new Vector3(0, 1, 0).cross(SUN_DIRECTION).normalize();
const SHADOW_UP = SUN_DIRECTION.clone().cross(SHADOW_RIGHT);
// A fitted shadow camera's size steps down from the whole map's in 10% rungs, so its texels
// keep their size, and stay on one grid, while the player pans at a given zoom.
const SIZE_STEP = 1.1;

interface Sphere {
  centre: Vector3;
  radius: number;
  /** Height of the tallest thing in it. */
  height: number;
}

// Scratch for fitting, so a refit allocates nothing.
const CORNERS = [-1, -1, 1, -1, -1, 1, 1, 1]; // the view's corners in clip space
const ray = new Vector3();
const point = new Vector3();
const us = new Float64Array(8);
const vs = new Float64Array(8);
const depths = new Float64Array(8);
const axis = { centre: 0, half: 0 };

// Whole map: an orthographic shadow camera that just contains the sphere around every
// caster and receiver, so no shadow is ever clipped.
function aimAtWhole(light: DirectionalLight, whole: Sphere) {
  const distance = whole.radius * 2;
  light.position.copy(whole.centre).addScaledVector(SUN_DIRECTION, distance);
  light.target.position.copy(whole.centre);
  light.target.updateMatrixWorld();
  const cam = light.shadow.camera;
  cam.left = -whole.radius;
  cam.right = whole.radius;
  cam.top = whole.radius;
  cam.bottom = -whole.radius;
  cam.near = distance - whole.radius;
  cam.far = distance + whole.radius;
  cam.updateProjectionMatrix();
}

// The slab of the map the camera can see, between the ground and the tallest roof or tree,
// is the hull of the view's corner rays cut at both heights. Writes those 8 points into
// us/vs (shadow map axes) and depths (towards the sun). False when a corner ray never
// comes down, i.e. the view reaches the horizon.
function projectVisibleSlab(camera: Camera, top: number): boolean {
  const eye = camera.position;
  for (let c = 0; c < 4; c++) {
    ray
      .set(CORNERS[2 * c], CORNERS[2 * c + 1], 1)
      .unproject(camera)
      .sub(eye);
    for (let level = 0; level < 2; level++) {
      const height = level * top;
      if (eye.y > height) {
        if (ray.y >= 0) return false;
        point.copy(eye).addScaledVector(ray, (height - eye.y) / ray.y);
      } else {
        // The camera is inside the slab: the view of it starts at the camera.
        point.copy(eye);
      }
      const i = 2 * c + level;
      us[i] = point.dot(SHADOW_RIGHT);
      vs[i] = point.dot(SHADOW_UP);
      depths[i] = point.dot(SUN_DIRECTION);
    }
  }
  return true;
}

// One axis of the fitted shadow camera: the points' extent clipped to the whole map's, rounded
// up to a rung, centred on a whole texel. The top rung is the whole map. Writes `axis`.
function fitAxis(values: Float64Array, wholeCentre: number, wholeHalf: number) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    lo = Math.min(lo, values[i]);
    hi = Math.max(hi, values[i]);
  }
  lo = Math.max(lo, wholeCentre - wholeHalf);
  hi = Math.min(hi, wholeCentre + wholeHalf);
  // At least a unit across, so the log below stays finite; plus a texel of slack so that
  // snapping the centre can't uncover an edge.
  const half = Math.max((hi - lo) / 2, 1) * (1 + 2 / SHADOW_MAP_SIZE);
  const rung = Math.max(0, Math.floor(Math.log(wholeHalf / half) / Math.log(SIZE_STEP)));
  axis.half = wholeHalf / SIZE_STEP ** rung;
  if (rung === 0) {
    axis.centre = wholeCentre;
    return;
  }
  const texel = (2 * axis.half) / SHADOW_MAP_SIZE;
  axis.centre = Math.round((lo + hi) / 2 / texel) * texel;
}

// Spend the shadow map on what is on screen. Every caster is inside the map's sphere, so
// shadows only land inside its square in shadow map space: the fit never needs more.
function fitShadow(light: DirectionalLight, camera: Camera, whole: Sphere) {
  if (!projectVisibleSlab(camera, whole.height)) {
    aimAtWhole(light, whole);
    return;
  }
  fitAxis(us, whole.centre.dot(SHADOW_RIGHT), whole.radius);
  const u = axis.centre;
  const halfU = axis.half;
  fitAxis(vs, whole.centre.dot(SHADOW_UP), whole.radius);
  const v = axis.centre;
  const halfV = axis.half;
  // Zoomed out far enough to see the whole map: keep the one fixed fit.
  if (halfU === whole.radius && halfV === whole.radius) {
    aimAtWhole(light, whole);
    return;
  }

  let sunward = -Infinity;
  let away = Infinity;
  for (let i = 0; i < depths.length; i++) {
    sunward = Math.max(sunward, depths[i]);
    away = Math.min(away, depths[i]);
  }
  // Longest stretch of sunbeam between a receiver and something that can shade it: from the
  // ground up to the tallest thing. Casters that far towards the sun, even off-screen, must
  // stay in the depth range, so start a unit above the highest of them.
  const sunbeam = whole.height / SUN_DIRECTION.y;
  const top = sunward + sunbeam + 1;
  light.position
    .set(0, 0, 0)
    .addScaledVector(SHADOW_RIGHT, u)
    .addScaledVector(SHADOW_UP, v)
    .addScaledVector(SUN_DIRECTION, top);
  light.target.position.copy(light.position).sub(SUN_DIRECTION);
  light.target.updateMatrixWorld();
  const cam = light.shadow.camera;
  cam.left = -halfU;
  cam.right = halfU;
  cam.top = halfV;
  cam.bottom = -halfV;
  cam.near = 1;
  cam.far = top - away;
  cam.updateProjectionMatrix();
}

/** The light's colours, for a map that wants its own weather. */
export interface LightColours {
  sky: string;
  ground: string;
  sun: string;
}

const DEFAULT_COLOURS: LightColours = { sky: SKY_LIGHT, ground: GROUND_LIGHT, sun: SUN };

/** Soft sky fill plus one shadow-casting sun whose shadow camera follows the view. */
export function MapLights({
  map,
  colours = DEFAULT_COLOURS,
}: {
  map: MapLayout;
  colours?: LightColours;
}) {
  const sun = useRef<DirectionalLight>(null);

  // A sphere around everything that casts a shadow.
  const whole = useMemo((): Sphere => {
    const { bounds, casters, height } = map;
    const centre = new Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    const reach = Math.max(
      ...casters.map((d) => Math.hypot(d.x - centre.x, d.z - centre.z) + d.radius),
    );
    return { centre, radius: Math.hypot(reach, height), height };
  }, [map]);

  // Refit only when the view has changed since the last fit. Comparing matrices rather than
  // listening for the controls' "change" also catches resizes and the last of the damping,
  // which the controls stop reporting below 1e-3 per frame.
  const fitted = useMemo(() => ({ view: new Matrix4(), projection: new Matrix4() }), []);
  const fittedWhole = useRef<Sphere>(null);

  // Default priority runs after the controls' own update (and the camera's target clamp),
  // and before this frame renders.
  useFrame(({ camera }) => {
    if (!sun.current) return;
    camera.updateMatrixWorld();
    if (
      fittedWhole.current === whole &&
      fitted.view.equals(camera.matrixWorld) &&
      fitted.projection.equals(camera.projectionMatrix)
    ) {
      return;
    }
    fittedWhole.current = whole;
    fitted.view.copy(camera.matrixWorld);
    fitted.projection.copy(camera.projectionMatrix);
    fitShadow(sun.current, camera, whole);
  });

  return (
    <>
      <hemisphereLight args={[colours.sky, colours.ground, 0.45]} />
      <directionalLight
        ref={sun}
        color={colours.sun}
        intensity={3}
        castShadow
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        // Just enough bias to keep sloped roofs free of acne without lifting shadows off
        // the walls; checked close up at the lowest camera angle.
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={1.5}
      />
    </>
  );
}

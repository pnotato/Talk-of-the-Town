import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type Camera, DirectionalLight, type EventDispatcher, Vector3 } from "three";
import { TOWN_HEIGHT, TREE_RADIUS, type TownLayout } from "./layoutTown.ts";

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
// Longest stretch of sunbeam between a receiver and something that can shade it: from the
// ground up to the tallest roof or tree. Casters that far towards the sun, even off-screen,
// must stay in the shadow camera's depth range.
const SUNBEAM = TOWN_HEIGHT / SUN_DIRECTION.y;
// A fitted shadow camera's size steps down from the whole town's in 10% rungs, so its texels
// keep their size, and stay on one grid, while the player pans at a given zoom.
const SIZE_STEP = 1.1;

interface Sphere {
  centre: Vector3;
  radius: number;
}

// Scratch for fitting, so a refit allocates nothing.
const CORNERS = [-1, -1, 1, -1, -1, 1, 1, 1]; // the view's corners in clip space
const ray = new Vector3();
const point = new Vector3();
const us = new Float64Array(8);
const vs = new Float64Array(8);
const depths = new Float64Array(8);
const axis = { centre: 0, half: 0 };

// Whole town: an orthographic shadow camera that just contains the sphere around every
// caster and receiver, so no shadow is ever clipped.
function aimAtTown(light: DirectionalLight, town: Sphere) {
  const distance = town.radius * 2;
  light.position.copy(town.centre).addScaledVector(SUN_DIRECTION, distance);
  light.target.position.copy(town.centre);
  light.target.updateMatrixWorld();
  const cam = light.shadow.camera;
  cam.left = -town.radius;
  cam.right = town.radius;
  cam.top = town.radius;
  cam.bottom = -town.radius;
  cam.near = distance - town.radius;
  cam.far = distance + town.radius;
  cam.updateProjectionMatrix();
}

// The slab of town the camera can see, between the ground and the tallest roof or tree,
// is the hull of the view's corner rays cut at both heights. Writes those 8 points into
// us/vs (shadow map axes) and depths (towards the sun). False when a corner ray never
// comes down, i.e. the view reaches the horizon.
function projectVisibleSlab(camera: Camera): boolean {
  const eye = camera.position;
  for (let c = 0; c < 4; c++) {
    ray
      .set(CORNERS[2 * c], CORNERS[2 * c + 1], 1)
      .unproject(camera)
      .sub(eye);
    for (let level = 0; level < 2; level++) {
      const height = level * TOWN_HEIGHT;
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

// One axis of the fitted shadow camera: the points' extent clipped to the town's, rounded
// up to a rung, centred on a whole texel. The top rung is the town itself. Writes `axis`.
function fitAxis(values: Float64Array, townCentre: number, townHalf: number) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    lo = Math.min(lo, values[i]);
    hi = Math.max(hi, values[i]);
  }
  lo = Math.max(lo, townCentre - townHalf);
  hi = Math.min(hi, townCentre + townHalf);
  // At least a unit across, so the log below stays finite; plus a texel of slack so that
  // snapping the centre can't uncover an edge.
  const half = Math.max((hi - lo) / 2, 1) * (1 + 2 / SHADOW_MAP_SIZE);
  const rung = Math.max(0, Math.floor(Math.log(townHalf / half) / Math.log(SIZE_STEP)));
  axis.half = townHalf / SIZE_STEP ** rung;
  if (rung === 0) {
    axis.centre = townCentre;
    return;
  }
  const texel = (2 * axis.half) / SHADOW_MAP_SIZE;
  axis.centre = Math.round((lo + hi) / 2 / texel) * texel;
}

// Spend the shadow map on what is on screen. Every caster is inside the town's sphere, so
// shadows only land inside its square in shadow map space: the fit never needs more.
function fitShadow(light: DirectionalLight, camera: Camera, town: Sphere) {
  if (!projectVisibleSlab(camera)) {
    aimAtTown(light, town);
    return;
  }
  fitAxis(us, town.centre.dot(SHADOW_RIGHT), town.radius);
  const u = axis.centre;
  const halfU = axis.half;
  fitAxis(vs, town.centre.dot(SHADOW_UP), town.radius);
  const v = axis.centre;
  const halfV = axis.half;
  // Zoomed out far enough to see the whole town: keep the one fixed fit.
  if (halfU === town.radius && halfV === town.radius) {
    aimAtTown(light, town);
    return;
  }

  let sunward = -Infinity;
  let away = Infinity;
  for (let i = 0; i < depths.length; i++) {
    sunward = Math.max(sunward, depths[i]);
    away = Math.min(away, depths[i]);
  }
  // Start a unit above the highest point that can shade anything in view.
  const top = sunward + SUNBEAM + 1;
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

/** Soft sky fill plus one shadow-casting sun whose shadow camera follows the view. */
export function TownLights({ layout }: { layout: TownLayout }) {
  const sun = useRef<DirectionalLight>(null);

  // A sphere around everything that casts or receives a shadow.
  const town = useMemo((): Sphere => {
    const { bounds, square, neighbourhoods, trees } = layout;
    const centre = new Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    const discs = [
      square,
      ...neighbourhoods,
      ...trees.map((t) => ({ x: t.x, z: t.z, radius: TREE_RADIUS * t.size })),
    ];
    const reach = Math.max(
      ...discs.map((d) => Math.hypot(d.x - centre.x, d.z - centre.z) + d.radius),
    );
    return { centre, radius: Math.hypot(reach, TOWN_HEIGHT) };
  }, [layout]);

  // Refit only when the view changes: the controls move, the window resizes or the town
  // changes.
  const controls = useThree((s) => s.controls) as EventDispatcher<{ change: object }> | null;
  const size = useThree((s) => s.size);
  const stale = useRef(true);
  useEffect(() => {
    stale.current = true;
    if (!controls) return;
    const refit = () => {
      stale.current = true;
    };
    controls.addEventListener("change", refit);
    return () => controls.removeEventListener("change", refit);
  }, [controls, town, size]);

  // Default priority runs after the controls' own update (and the camera's target clamp),
  // and before this frame renders.
  useFrame(({ camera }) => {
    if (!stale.current || !sun.current) return;
    stale.current = false;
    camera.updateMatrixWorld();
    fitShadow(sun.current, camera, town);
  });

  return (
    <>
      <hemisphereLight args={[SKY_LIGHT, GROUND_LIGHT, 0.45]} />
      <directionalLight
        ref={sun}
        color={SUN}
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

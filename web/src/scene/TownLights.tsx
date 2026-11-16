import { useLayoutEffect, useMemo, useRef } from "react";
import { DirectionalLight, Vector3 } from "three";
import { TOWN_HEIGHT, TREE_RADIUS, type TownLayout } from "./layoutTown.ts";

const SKY_LIGHT = "#e3eef7";
const GROUND_LIGHT = "#8d9a78";
const SUN = "#fff3e0";
// From front-left and high, so the faces turned towards the default camera are lit and
// shadows fall back and to the right.
const SUN_DIRECTION = new Vector3(-0.55, 1.15, 0.6).normalize();
const SHADOW_MAP_SIZE = 2048;

/** Soft sky fill plus one shadow-casting sun whose shadow camera hugs the town. */
export function TownLights({ layout }: { layout: TownLayout }) {
  const sun = useRef<DirectionalLight>(null);

  // A sphere around everything that casts or receives a shadow. An orthographic shadow
  // camera that just contains it never clips a shadow, whatever the sun direction.
  const { centre, radius } = useMemo(() => {
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

  useLayoutEffect(() => {
    const light = sun.current;
    if (!light) return;
    const distance = radius * 2;
    light.position.copy(centre).addScaledVector(SUN_DIRECTION, distance);
    light.target.position.copy(centre);
    light.target.updateMatrixWorld();

    const cam = light.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = distance - radius;
    cam.far = distance + radius;
    cam.updateProjectionMatrix();
  }, [centre, radius]);

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
        shadow-radius={2.5}
      />
    </>
  );
}

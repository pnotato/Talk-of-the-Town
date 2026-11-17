import { useEffect, useMemo } from "react";
import { PlaneGeometry, RingGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TownPath } from "./layoutTown.ts";

const PATH = "#d9caa5";

/** Every spoke and loop street merged into one flat mesh: one draw call. */
export function TownPaths({ paths }: { paths: TownPath[] }) {
  const geometry = useMemo(
    () =>
      mergeGeometries(
        paths.map((p) => {
          if (p.kind === "ring") {
            const ring = new RingGeometry(p.radius - p.width / 2, p.radius + p.width / 2, 96);
            return ring.rotateX(-Math.PI / 2).translate(p.x, 0, p.z);
          }
          const dx = p.x2 - p.x1;
          const dz = p.z2 - p.z1;
          return new PlaneGeometry(Math.hypot(dx, dz), p.width)
            .rotateX(-Math.PI / 2)
            .rotateY(-Math.atan2(dz, dx))
            .translate((p.x1 + p.x2) / 2, 0, (p.z1 + p.z2) / 2);
        }),
      ),
    [paths],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Overlapping pieces share one colour, so where spokes meet loops nothing can flicker.
  // Above the lawns by height and polygonOffset.
  return (
    <mesh geometry={geometry} position-y={0.02} receiveShadow>
      <meshLambertMaterial
        color={PATH}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

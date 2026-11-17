import { useLayoutEffect, useRef } from "react";
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { TownNeighbourhood } from "./layoutTown.ts";

// Far past where the fog turns solid even on a very narrow screen, so the world never ends.
export const GROUND_RADIUS = 5000;
export const GRASS = "#a3b292";
const LAWN = "#b3c39d"; // each neighbourhood's own lawn, a touch fresher than the fields

/** Open fields plus one round lawn under each neighbourhood, so each reads as a group. */
export function TownGround({ neighbourhoods }: { neighbourhoods: TownNeighbourhood[] }) {
  const lawns = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = lawns.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    neighbourhoods.forEach((n, i) => {
      // Unit circle in XY, laid flat and stretched to the neighbourhood's radius.
      matrix.compose(position.set(n.x, 0, n.z), flat, scale.set(n.radius, n.radius, 1));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Frustum culling caches the instances' bounding sphere; refresh it with the matrices.
    mesh.computeBoundingSphere();
  }, [neighbourhoods]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[GROUND_RADIUS, 96]} />
        <meshLambertMaterial color={GRASS} />
      </mesh>
      {/* Raised a hair and polygon-offset so the lawns never z-fight the fields. */}
      <instancedMesh
        ref={lawns}
        args={[undefined, undefined, neighbourhoods.length]}
        position-y={0.01}
        receiveShadow
      >
        <circleGeometry args={[1, 96]} />
        <meshLambertMaterial
          color={LAWN}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </instancedMesh>
    </group>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { TREE_RADIUS, type TownTree } from "./layoutTown.ts";

const TRUNK_HEIGHT = 0.9;
const GOLDEN_ANGLE = 2.39996; // radians; turns neighbouring trees far apart
const TRUNK = "#7d5f45";
const LEAVES = ["#6e9a59", "#7aa562", "#628f53", "#86ac68", "#6a9460"];

/** Chunky low-poly trees: one instanced mesh for trunks, one for canopies. */
export function TownTrees({ trees }: { trees: TownTree[] }) {
  const geometries = useMemo(
    () => ({
      trunk: new CylinderGeometry(0.14, 0.2, TRUNK_HEIGHT, 6).translate(0, TRUNK_HEIGHT / 2, 0),
      // Slightly tall, sitting on the trunk with a little overlap.
      canopy: new IcosahedronGeometry(TREE_RADIUS, 1)
        .scale(1, 1.15, 1)
        .translate(0, TRUNK_HEIGHT + TREE_RADIUS * 0.9, 0),
    }),
    [],
  );
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);

  const trunks = useRef<InstancedMesh>(null);
  const canopies = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const matrix = new Matrix4();
    const position = new Vector3();
    const turn = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const color = new Color();
    trees.forEach((t, i) => {
      // Turned by index so the facets don't all line up; the turn never changes the footprint.
      matrix.compose(
        position.set(t.x, 0, t.z),
        turn.setFromAxisAngle(up, i * GOLDEN_ANGLE),
        scale.setScalar(t.size),
      );
      trunks.current?.setMatrixAt(i, matrix);
      canopies.current?.setMatrixAt(i, matrix);
      canopies.current?.setColorAt(i, color.set(LEAVES[(i * 7) % LEAVES.length]));
    });
    for (const mesh of [trunks.current, canopies.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Frustum culling caches the instances' bounding sphere; refresh it with the matrices.
      mesh.computeBoundingSphere();
    }
  }, [trees]);

  return (
    <group>
      <instancedMesh
        ref={trunks}
        args={[geometries.trunk, undefined, trees.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial color={TRUNK} />
      </instancedMesh>
      <instancedMesh
        ref={canopies}
        args={[geometries.canopy, undefined, trees.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial flatShading />
      </instancedMesh>
    </group>
  );
}

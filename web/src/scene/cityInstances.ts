import { useLayoutEffect, useRef } from "react";
import { BoxGeometry, Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";

/** A unit box shared by every instanced prop; scale it per instance. */
export const UNIT_BOX = new BoxGeometry(1, 1, 1);

export interface Placement {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  sx: number;
  sy: number;
  sz: number;
  color?: string;
}

// Writes placements into an instanced mesh once; never per frame.
export function useInstances(placements: Placement[]) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const position = new Vector3();
    const turn = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const color = new Color();
    placements.forEach((p, i) => {
      matrix.compose(
        position.set(p.x, p.y, p.z),
        turn.setFromAxisAngle(up, p.rotationY),
        scale.set(p.sx, p.sy, p.sz),
      );
      mesh.setMatrixAt(i, matrix);
      if (p.color) mesh.setColorAt(i, color.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Frustum culling caches the instances' bounding sphere; refresh it with the matrices.
    mesh.computeBoundingSphere();
  }, [placements]);
  return ref;
}

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  type HarbourTree,
  type HarbourTreeKind,
  MAPLE_HEIGHT,
  MAPLE_RADIUS,
  PINE_HEIGHT,
  PINE_RADIUS,
} from "./layoutHarbour.ts";

const GOLDEN_ANGLE = 2.39996; // radians; turns neighbouring trees far apart
const TRUNK = "#76573f";
// Early autumn: most maples have turned, a few hold on to their green.
const MAPLES = ["#df7b31", "#cc4b3b", "#e9b43c", "#b9572f", "#e59a3b", "#d8653a", "#93ad5b"];
const PINES = ["#3e6a4f", "#4a7858", "#355d46", "#55805f"];

function pineGeometry(): { trunk: BufferGeometry; crown: BufferGeometry } {
  const trunkHeight = PINE_HEIGHT * 0.18;
  // Three stacked tiers, each narrower, the top one coming to a point at PINE_HEIGHT.
  const tiers = [
    { radius: PINE_RADIUS, height: PINE_HEIGHT * 0.42, base: trunkHeight * 0.8 },
    { radius: PINE_RADIUS * 0.78, height: PINE_HEIGHT * 0.36, base: PINE_HEIGHT * 0.38 },
    { radius: PINE_RADIUS * 0.52, height: PINE_HEIGHT * 0.3, base: PINE_HEIGHT * 0.7 },
  ];
  return {
    trunk: new CylinderGeometry(0.16, 0.24, trunkHeight, 6).translate(0, trunkHeight / 2, 0),
    crown: mergeGeometries(
      tiers.map((t) =>
        new ConeGeometry(t.radius, t.height, 7).translate(0, t.base + t.height / 2, 0),
      ),
    ),
  };
}

function mapleGeometry(): { trunk: BufferGeometry; crown: BufferGeometry } {
  const trunkHeight = MAPLE_HEIGHT * 0.3;
  const r = MAPLE_RADIUS;
  // A full, lumpy crown: one big ball with two smaller ones tucked into its shoulders.
  const middle = MAPLE_HEIGHT - r * 0.95;
  const crown = mergeGeometries([
    new IcosahedronGeometry(r * 0.88, 1).translate(0, middle, 0),
    new IcosahedronGeometry(r * 0.6, 1).translate(r * 0.42, middle - r * 0.25, r * 0.2),
    new IcosahedronGeometry(r * 0.55, 1).translate(-r * 0.4, middle - r * 0.18, -r * 0.25),
  ]);
  return {
    trunk: new CylinderGeometry(0.15, 0.22, trunkHeight + 0.4, 6).translate(
      0,
      (trunkHeight + 0.4) / 2,
      0,
    ),
    crown,
  };
}

function Grove({ trees, kind }: { trees: HarbourTree[]; kind: HarbourTreeKind }) {
  const geometry = useMemo(() => (kind === "pine" ? pineGeometry() : mapleGeometry()), [kind]);
  useEffect(() => () => Object.values(geometry).forEach((g) => g.dispose()), [geometry]);
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const matrix = new Matrix4();
    const position = new Vector3();
    const turn = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const color = new Color();
    const palette = kind === "pine" ? PINES : MAPLES;
    trees.forEach((t, i) => {
      // Turned by index so the facets don't all line up; the turn never changes the footprint.
      matrix.compose(
        position.set(t.x, 0, t.z),
        turn.setFromAxisAngle(up, i * GOLDEN_ANGLE),
        scale.setScalar(t.size),
      );
      trunks.current?.setMatrixAt(i, matrix);
      crowns.current?.setMatrixAt(i, matrix);
      const tint = (((i * 5 + Math.round(t.x)) % palette.length) + palette.length) % palette.length;
      crowns.current?.setColorAt(i, color.set(palette[tint]));
    });
    for (const mesh of [trunks.current, crowns.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [trees, kind]);

  return (
    <group>
      <instancedMesh
        ref={trunks}
        args={[geometry.trunk, undefined, trees.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial color={TRUNK} />
      </instancedMesh>
      <instancedMesh
        ref={crowns}
        args={[geometry.crown, undefined, trees.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial flatShading />
      </instancedMesh>
    </group>
  );
}

/** Windswept pines on the shores and autumn maples through the town: two instanced groves. */
export function HarbourTrees({ trees }: { trees: HarbourTree[] }) {
  const pines = useMemo(() => trees.filter((t) => t.kind === "pine"), [trees]);
  const maples = useMemo(() => trees.filter((t) => t.kind === "maple"), [trees]);
  return (
    <group>
      <Grove trees={pines} kind="pine" />
      <Grove trees={maples} kind="maple" />
    </group>
  );
}

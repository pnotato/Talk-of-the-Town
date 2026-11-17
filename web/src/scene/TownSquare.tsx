import { useEffect, useMemo } from "react";
import {
  CircleGeometry,
  CylinderGeometry,
  LatheGeometry,
  RingGeometry,
  SphereGeometry,
  Vector2,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TownSquare as Square } from "./layoutTown.ts";

const PAVING = "#e6dcc6";
const TRIM = "#cdbf9f";
const STONE = "#c9c1b0";
const WATER = "#8cc3d6";

function buildSquareGeometries({ radius, fountainRadius: r }: Square) {
  const flat = (g: RingGeometry | CircleGeometry) => g.rotateX(-Math.PI / 2);

  const paving = flat(new CircleGeometry(radius, 96));
  // A kerb at the edge, a ring of setts around the fountain and one halfway between.
  const halfway = (r + radius) / 2;
  const trim = mergeGeometries([
    flat(new RingGeometry(radius - 0.35, radius, 96)),
    flat(new RingGeometry(halfway - 0.15, halfway + 0.15, 96)),
    flat(new RingGeometry(r + 0.7, r + 1.0, 64)),
  ]);

  // Basin profile, outside wall up and over the lip, down to the water.
  const basin = new LatheGeometry(
    [
      new Vector2(r, 0),
      new Vector2(r, 0.45),
      new Vector2(r - 0.05, 0.55),
      new Vector2(r - 0.3, 0.55),
      new Vector2(r - 0.32, 0.3),
    ],
    48,
  );
  // Two tiers, tall enough to spot over a crowd of 1-unit blobs.
  const stone = mergeGeometries([
    basin,
    new CylinderGeometry(0.22, 0.3, 1.6, 16).translate(0, 1.1, 0),
    new CylinderGeometry(0.85, 0.32, 0.28, 32).translate(0, 1.75, 0),
    new CylinderGeometry(0.12, 0.16, 0.6, 12).translate(0, 2.19, 0),
    new CylinderGeometry(0.42, 0.16, 0.18, 24).translate(0, 2.5, 0),
    new SphereGeometry(0.14, 12, 8).translate(0, 2.72, 0),
  ]);
  const water = mergeGeometries([
    flat(new CircleGeometry(r - 0.3, 48)).translate(0, 0.4, 0),
    flat(new CircleGeometry(0.78, 32)).translate(0, 1.87, 0),
    flat(new CircleGeometry(0.38, 24)).translate(0, 2.57, 0),
  ]);

  return { paving, trim, stone, water };
}

/** The paved square where blobs will gather, with a fountain as its focal point. */
export function TownSquare({ square }: { square: Square }) {
  const geometries = useMemo(() => buildSquareGeometries(square), [square]);
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);

  // Paving sits above the spokes that run into it, by height and polygonOffset.
  return (
    <group position={[square.x, 0, square.z]}>
      <mesh geometry={geometries.paving} position-y={0.03} receiveShadow>
        <meshLambertMaterial
          color={PAVING}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
        />
      </mesh>
      <mesh geometry={geometries.trim} position-y={0.04} receiveShadow>
        <meshLambertMaterial
          color={TRIM}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
      </mesh>
      <mesh geometry={geometries.stone} castShadow receiveShadow>
        <meshLambertMaterial color={STONE} />
      </mesh>
      <mesh geometry={geometries.water}>
        <meshPhongMaterial color={WATER} shininess={80} specular="#ffffff" />
      </mesh>
    </group>
  );
}

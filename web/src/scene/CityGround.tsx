import { useEffect, useMemo } from "react";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CityLayout, CityRect } from "./layoutCity.ts";
import type { Point } from "./mapLayout.ts";
import { laneDashes, zebraStripes } from "./roadMarkings.ts";
import { GRASS, GROUND_RADIUS } from "./TownGround.tsx";

/** Height of the raised sidewalks and the plaza island; things on them stand this high. */
export const CURB = 0.15;
/** Top of the plaza paving and the lawns laid on the slabs: where blobs stand. */
export const SURFACE = CURB + 0.01;

const ASPHALT = "#5d6169";
const PAINT = "#eeeae0";
const SIDEWALK = "#cdc6b8";
const PAVING = "#e6dcc6";
const LAWN = "#8fae6a"; // the park lawns

// Flat rectangles facing up at height y, as one geometry.
function flatRects(rects: CityRect[], y: number): BufferGeometry {
  const positions: number[] = [];
  for (const { x, z, width, depth } of rects) {
    const [x0, x1, z0, z1] = [x - width / 2, x + width / 2, z - depth / 2, z + depth / 2];
    positions.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    "normal",
    new Float32BufferAttribute(
      positions.map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  return geometry;
}

function flatPolygon(points: Point[], y: number): ShapeGeometry {
  // Shapes are drawn in x/y; laid flat, shape y becomes -z.
  const shape = new Shape();
  points.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)));
  return new ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, y, 0);
}

function slabs(rects: CityRect[]): BufferGeometry {
  return mergeGeometries(
    rects.map((r) => new BoxGeometry(r.width, CURB, r.depth).translate(r.x, CURB / 2, r.z)),
  );
}

/** Fields, roads with their paint, raised sidewalks, and the plaza island. */
export function CityGround({ city }: { city: CityLayout }) {
  const geometries = useMemo(
    () => ({
      roads: flatRects(city.roads, 0.02),
      paint: flatRects([...zebraStripes(city.crosswalks), ...laneDashes(city.roads)], 0.03),
      sidewalks: slabs([...city.blocks, city.plaza]),
      paving: flatPolygon(city.plaza.outline, SURFACE),
      lawns: flatRects(city.parks, SURFACE),
    }),
    [city],
  );
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);

  // Flat layers keep apart by height and polygonOffset, so none z-fight at any zoom.
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[GROUND_RADIUS, 96]} />
        <meshLambertMaterial color={GRASS} />
      </mesh>
      <mesh geometry={geometries.roads} receiveShadow>
        <meshLambertMaterial
          color={ASPHALT}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      <mesh geometry={geometries.paint} receiveShadow>
        <meshLambertMaterial
          color={PAINT}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      <mesh geometry={geometries.sidewalks} castShadow receiveShadow>
        <meshLambertMaterial color={SIDEWALK} />
      </mesh>
      <mesh geometry={geometries.paving} receiveShadow>
        <meshLambertMaterial
          color={PAVING}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      <mesh geometry={geometries.lawns} receiveShadow>
        <meshLambertMaterial
          color={LAWN}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
    </group>
  );
}

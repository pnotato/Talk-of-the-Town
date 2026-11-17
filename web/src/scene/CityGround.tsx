import { useEffect, useMemo } from "react";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CityLayout, CityRect } from "./layoutCity.ts";
import type { Point } from "./mapLayout.ts";
import { GRASS, GROUND_RADIUS } from "./TownGround.tsx";

/** Height of the raised sidewalks and the plaza island; things on them stand this high. */
export const CURB = 0.15;

const ASPHALT = "#5d6169";
const PAINT = "#eeeae0";
const SIDEWALK = "#cdc6b8";
const PAVING = "#e6dcc6";
const BED = "#8fae6a"; // the plaza's planted beds and the park lawns

const CROSSWALK = 2.4; // depth of a zebra crossing along the road
const STRIPE = 0.55;
const DASH = 2;
const LINE = 0.18;

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

// Lane dashes down the middle of every road between junctions, and zebra crossings across
// each road where it leaves a junction (not on the outer ring road, which leads nowhere).
function roadMarkings(city: CityLayout): CityRect[] {
  const { roads, bounds } = city;
  const marks: CityRect[] = [];
  for (const road of roads) {
    const vertical = road.depth > road.width;
    const along = (r: CityRect) =>
      vertical ? [r.z - r.depth / 2, r.z + r.depth / 2] : [r.x - r.width / 2, r.x + r.width / 2];
    const across = vertical ? road.x : road.z;
    const width = vertical ? road.width : road.depth;
    const outer = vertical
      ? road.x - width / 2 <= bounds.minX || road.x + width / 2 >= bounds.maxX
      : road.z - width / 2 <= bounds.minZ || road.z + width / 2 >= bounds.maxZ;
    const junctions = roads
      .filter((r) => r.depth > r.width !== vertical)
      .map(along)
      .sort((a, b) => a[0] - b[0]);
    const rect = (from: number, to: number, offset: number, size: number): CityRect =>
      vertical
        ? { x: across + offset, z: (from + to) / 2, width: size, depth: to - from }
        : { x: (from + to) / 2, z: across + offset, width: to - from, depth: size };

    for (let k = 0; k + 1 < junctions.length; k++) {
      const a = junctions[k][1];
      const b = junctions[k + 1][0];
      if (!outer) {
        for (const [from, to] of [
          [a + 0.6, a + 0.6 + CROSSWALK],
          [b - 0.6 - CROSSWALK, b - 0.6],
        ]) {
          for (let s = -width / 2 + 0.6; s + STRIPE <= width / 2 - 0.4; s += 2 * STRIPE) {
            marks.push(rect(from, to, s + STRIPE / 2, STRIPE));
          }
        }
      }
      for (
        let d = a + 0.6 + CROSSWALK + 1.5;
        d + DASH <= b - 0.6 - CROSSWALK - 1.5;
        d += 2 * DASH
      ) {
        marks.push(rect(d, d + DASH, 0, LINE));
      }
    }
  }
  return marks;
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
      paint: flatRects(roadMarkings(city), 0.03),
      sidewalks: slabs([...city.blocks, city.plaza]),
      paving: flatPolygon(city.plaza.outline, CURB + 0.01),
      beds: mergeGeometries([
        ...city.plaza.beds.map((bed) => flatPolygon(bed, CURB + 0.01)),
        ...city.parks.map(({ x, z, width, depth }) =>
          flatPolygon(
            [
              { x: x - width / 2, z: z - depth / 2 },
              { x: x + width / 2, z: z - depth / 2 },
              { x: x + width / 2, z: z + depth / 2 },
              { x: x - width / 2, z: z + depth / 2 },
            ],
            CURB + 0.01,
          ),
        ),
      ]),
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
      <mesh geometry={geometries.beds} receiveShadow>
        <meshLambertMaterial
          color={BED}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
    </group>
  );
}

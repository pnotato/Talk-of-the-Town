import {
  type BufferGeometry,
  CapsuleGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape as Outline,
  SphereGeometry,
  Vector2,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

/** A blob's culture (docs/BLOBS.md). Colour will carry scores, so the silhouette alone must tell these apart. */
export type Shape = "square" | "circle" | "triangle" | "star" | "tear" | "capsule";

export const SHAPES: readonly Shape[] = ["square", "circle", "triangle", "star", "tear", "capsule"];

const RADIAL_SEGMENTS = 64;

// Adult heights in world units, tuned by eye so every silhouette carries a similar visual mass:
// the solid cube stands shorter, the sparser cone and star stand taller.
const ADULT_HEIGHT: Record<Shape, number> = {
  square: 0.86,
  circle: 0.96,
  triangle: 1.14,
  star: 1.06,
  tear: 1.1,
  capsule: 1.1,
};

/** Centres the geometry on the y axis, sets its base on y = 0 and scales it to `height`. */
function standOnGround(geometry: BufferGeometry, height: number): BufferGeometry {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  const scale = height / (max.y - min.y);
  geometry.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Arc points that replace corner `b` of the path a → b → c with a fillet of the given radius. */
function roundCorner(a: Vector2, b: Vector2, c: Vector2, radius: number, steps = 8): Vector2[] {
  const u = a.clone().sub(b).normalize();
  const v = c.clone().sub(b).normalize();
  const half = Math.acos(u.dot(v)) / 2;
  const reach = radius / Math.tan(half);
  const centre = u
    .clone()
    .add(v)
    .normalize()
    .multiplyScalar(radius / Math.sin(half))
    .add(b);
  const from = u.multiplyScalar(reach).add(b).sub(centre).angle();
  const to = v.multiplyScalar(reach).add(b).sub(centre).angle();
  // angle() is in [0, 2π); wrap the difference so the arc takes the short way round the corner.
  const sweep = ((to - from + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + (sweep * i) / steps;
    return new Vector2(Math.cos(t), Math.sin(t)).multiplyScalar(radius).add(centre);
  });
}

/** Cone with a filleted rim and a rounded tip, so it reads as a soft blob rather than a traffic cone. */
function softCone(): BufferGeometry {
  const centre = new Vector2(0, 0);
  const rim = new Vector2(0.5, 0);
  const apex = new Vector2(0, 1.1);
  // The tip is the corner between the slope and its mirror image. The arc is symmetric about the
  // axis, so its first half runs from the slope to the very top.
  const tip = roundCorner(rim, apex, new Vector2(-rim.x, rim.y), 0.07, 16).slice(0, 9);
  return new LatheGeometry(
    [centre, ...roundCorner(centre, rim, apex, 0.1), ...tip],
    RADIAL_SEGMENTS,
  );
}

/** Lathe of the teardrop curve r = sin t · sin(t/2)^1.5, tip up: round bottom, then a tapered point. */
function teardrop(): BufferGeometry {
  const steps = 64;
  const profile = Array.from({ length: steps + 1 }, (_, i) => {
    const t = Math.PI * (1 - i / steps);
    return new Vector2(0.62 * Math.sin(t) * Math.sin(t / 2) ** 1.5, (1 + Math.cos(t)) / 2);
  });
  return new LatheGeometry(profile, RADIAL_SEGMENTS);
}

/** Upright five-point star facing +z, extruded and bevelled so it has body from every angle. */
function puffyStar(): BufferGeometry {
  const corners = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? 0.5 : 0.25;
    const angle = Math.PI / 2 + (i * Math.PI) / 5;
    return new Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(radius);
  });
  // Soften both the points and the notches; the notch radius must exceed the bevel size or the
  // bevel's outward offset folds over itself there.
  const outline = corners.flatMap((corner, i) =>
    roundCorner(corners.at(i - 1)!, corner, corners[(i + 1) % 10], i % 2 === 0 ? 0.07 : 0.09),
  );
  const geometry = toCreasedNormals(
    new ExtrudeGeometry(new Outline(outline), {
      depth: 0.18,
      bevelThickness: 0.08,
      bevelSize: 0.05,
      bevelSegments: 6,
      curveSegments: 1,
    }),
    Math.PI / 4,
  );
  // Creasing also blends the caps into the bevel, which tilts the normals of the caps' long, thin
  // triangles and shades the flat front unevenly. Group 0 holds the caps: make them flat again.
  const normal = geometry.getAttribute("normal");
  const { start, count } = geometry.groups[0];
  for (let i = start; i < start + count; i++) normal.setXYZ(i, 0, 0, Math.sign(normal.getZ(i)));
  return geometry;
}

/**
 * One geometry per shape, built once and shared by every blob. Each stands on y = 0, centred on
 * the y axis, faces +z and is at adult size.
 */
export const BLOB_GEOMETRY: Record<Shape, BufferGeometry> = {
  square: standOnGround(new RoundedBoxGeometry(1, 1, 1, 6, 0.16), ADULT_HEIGHT.square),
  circle: standOnGround(new SphereGeometry(0.5, 64, 40), ADULT_HEIGHT.circle),
  triangle: standOnGround(softCone(), ADULT_HEIGHT.triangle),
  star: standOnGround(puffyStar(), ADULT_HEIGHT.star),
  tear: standOnGround(teardrop(), ADULT_HEIGHT.tear),
  capsule: standOnGround(new CapsuleGeometry(0.36, 0.36, 16, 48), ADULT_HEIGHT.capsule),
};

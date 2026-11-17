import {
  type BufferGeometry,
  CatmullRomCurve3,
  Mesh,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BLOB_GEOMETRY, SHAPES, type Shape } from "./blobGeometry.ts";
import type { BrowStyle, EyeStyle, Mouth } from "./blobMood.ts";

// Face parts for every shape, built once and shared: one geometry per (shape, part). Each part is
// drawn in face space and projected straight back onto the body's front surface, following its
// normal, so faces hug the cone's slope, the sphere's curve and the star's flat front alike. Parts
// are half sunk into the surface, which reads as painted on without z-fighting.

// Where the face centre sits on each adult body (height in world units) and how big it is: low on
// the cone and the tear, where the front is broad, and kept inside the star's central pentagon.
const FACE_ANCHOR: Record<Shape, { y: number; size: number }> = {
  square: { y: 0.46, size: 1 },
  circle: { y: 0.46, size: 1 },
  triangle: { y: 0.36, size: 0.9 },
  star: { y: 0.44, size: 0.85 },
  tear: { y: 0.34, size: 1 },
  capsule: { y: 0.52, size: 0.95 },
};

/** A point in face space: x right, y up, from the face centre, in world units at face size 1. */
type FacePoint2 = readonly [x: number, y: number];

/** A line drawn on the face. */
type Stroke = { points: FacePoint2[]; closed?: boolean };

const EYE_X = 0.085;
const EYE_Y = 0.035;
const EYE_RADIUS = 0.042;
const STROKE_RADIUS = 0.014;

function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 12) {
  return Array.from({ length: steps + 1 }, (_, i): FacePoint2 => {
    const a = from + ((to - from) * i) / steps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

function segment([x0, y0]: FacePoint2, [x1, y1]: FacePoint2, steps = 4) {
  return Array.from({ length: steps + 1 }, (_, i): FacePoint2 => {
    const t = i / steps;
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  });
}

// side -1 is the left brow; its inner end is towards the centre (+x). `lift` > 0 raises the inner
// end (worried), < 0 lowers it (angry).
function brow(side: number, lift: number): Stroke {
  const [cx, cy, half] = [side * EYE_X, EYE_Y + 0.08, 0.042];
  const [dx, dy] = [half * Math.cos(lift), half * Math.sin(lift)];
  return { points: segment([cx + side * dx, cy - dy], [cx - side * dx, cy + dy]) };
}

/** Every face part in face space. Moods pick from these (MOOD_FACE in blobMood.ts). */
export const FACE_PARTS = {
  eyeDots: [
    [-EYE_X, EYE_Y],
    [EYE_X, EYE_Y],
  ] as FacePoint2[],
  // Shut, relaxed eyes: a shallow downward curve.
  shutEyes: [-1, 1].map((side): Stroke => ({
    points: arc(side * EYE_X, EYE_Y + 0.02, 0.04, (-3 * Math.PI) / 4, -Math.PI / 4, 6),
  })),
  brows: {
    worried: [brow(-1, 0.4), brow(1, 0.4)],
    angry: [brow(-1, -0.4), brow(1, -0.4)],
  } satisfies Record<BrowStyle, Stroke[]>,
  // Each mouth has a pivot at its middle, so it can open and close about it.
  mouths: {
    smile: { points: arc(0, 0.01, 0.06, (-5 * Math.PI) / 6, -Math.PI / 6), pivot: [0, -0.035] },
    frown: { points: arc(0, -0.105, 0.06, Math.PI / 6, (5 * Math.PI) / 6), pivot: [0, -0.06] },
    line: { points: segment([-0.05, -0.04], [0.05, -0.04], 6), pivot: [0, -0.04] },
    o: { points: arc(0, -0.045, 0.028, 0, 2 * Math.PI, 16), closed: true, pivot: [0, -0.045] },
  } satisfies Record<Mouth, Stroke & { pivot: FacePoint2 }>,
  /** Where a phone is held: below the mouth. */
  phone: [0, -0.19] as FacePoint2,
};

export type FacePoint = { point: Vector3; normal: Vector3 };

const raycaster = new Raycaster();
const towardsBody = new Vector3(0, 0, -1);
const bodies = Object.fromEntries(SHAPES.map((s) => [s, new Mesh(BLOB_GEOMETRY[s])])) as Record<
  Shape,
  Mesh
>;

/** Projects a face-space point straight back onto a shape's front surface. Throws on a miss. */
export function onBody(shape: Shape, [x, y]: FacePoint2): FacePoint {
  const anchor = FACE_ANCHOR[shape];
  raycaster.set(new Vector3(x * anchor.size, anchor.y + y * anchor.size, 10), towardsBody);
  const [hit] = raycaster.intersectObject(bodies[shape]);
  if (!hit?.normal) throw new Error(`face point (${x}, ${y}) misses the ${shape} blob`);
  return { point: hit.point, normal: hit.normal };
}

const FORWARD = new Vector3(0, 0, 1);

function dots(shape: Shape, points: FacePoint2[]): BufferGeometry {
  const radius = EYE_RADIUS * FACE_ANCHOR[shape].size;
  return mergeGeometries(
    points.map((p) => {
      const { point, normal } = onBody(shape, p);
      return new SphereGeometry(1, 20, 14)
        .scale(radius, radius * 1.15, radius * 0.5)
        .applyQuaternion(new Quaternion().setFromUnitVectors(FORWARD, normal))
        .translate(point.x, point.y, point.z);
    }),
  );
}

function strokes(shape: Shape, lines: Stroke[]): BufferGeometry {
  const radius = STROKE_RADIUS * FACE_ANCHOR[shape].size;
  return mergeGeometries(
    lines.flatMap(({ points, closed = false }) => {
      const path = points.map((p) => onBody(shape, p).point);
      const tube = new TubeGeometry(new CatmullRomCurve3(path, closed), 32, radius, 8, closed);
      if (closed) return [tube];
      // Round the tube's open ends.
      const ends = [path[0], path[path.length - 1]].map((p) =>
        new SphereGeometry(radius, 8, 6).translate(p.x, p.y, p.z),
      );
      return [tube, ...ends];
    }),
  );
}

/** A mouth in its own frame: origin at the pivot on the surface, +z out of the surface there. */
export type MouthPart = { geometry: BufferGeometry; position: Vector3; quaternion: Quaternion };

function mouth(shape: Shape, style: Mouth): MouthPart {
  const { pivot, ...line } = FACE_PARTS.mouths[style];
  const { point, normal } = onBody(shape, pivot);
  const quaternion = new Quaternion().setFromUnitVectors(FORWARD, normal);
  const geometry = strokes(shape, [line])
    .translate(-point.x, -point.y, -point.z)
    .applyQuaternion(quaternion.clone().invert());
  return { geometry, position: point, quaternion };
}

const byShape = <T>(build: (shape: Shape) => T) =>
  Object.fromEntries(SHAPES.map((s) => [s, build(s)])) as Record<Shape, T>;

export const EYES: Record<Shape, Record<EyeStyle, BufferGeometry>> = byShape((s) => ({
  open: dots(s, FACE_PARTS.eyeDots),
  shut: strokes(s, FACE_PARTS.shutEyes),
}));

export const BROWS: Record<Shape, Record<BrowStyle, BufferGeometry>> = byShape((s) => ({
  worried: strokes(s, FACE_PARTS.brows.worried),
  angry: strokes(s, FACE_PARTS.brows.angry),
}));

export const MOUTHS: Record<Shape, Record<Mouth, MouthPart>> = byShape((s) => ({
  smile: mouth(s, "smile"),
  frown: mouth(s, "frown"),
  line: mouth(s, "line"),
  o: mouth(s, "o"),
}));

/** Where each shape holds its phone: a little in front of the body, below the mouth. */
export const PHONE_SPOT: Record<Shape, Vector3> = byShape((s) => {
  const { point } = onBody(s, FACE_PARTS.phone);
  return point.add(new Vector3(0, 0, 0.12));
});

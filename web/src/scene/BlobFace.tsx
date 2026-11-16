import {
  type BufferGeometry,
  CatmullRomCurve3,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BLOB_GEOMETRY, SHAPES, type Shape } from "./blobGeometry.ts";

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

// Face layout at size 1, in world units relative to the face centre.
const EYE_X = 0.085;
const EYE_Y = 0.035;
const EYE_RADIUS = 0.042;
const SMILE_Y = 0.01; // centre of the circle the smile is cut from
const SMILE_RADIUS = 0.06;
const SMILE_THICKNESS = 0.014;
const SMILE_SAMPLES = 12;

const FORWARD = new Vector3(0, 0, 1);

/**
 * Builds one face geometry for a shape. Every feature point is projected straight back onto the
 * body's front surface and follows its normal, so the face hugs the cone's slope, the sphere's
 * curve and the star's flat front alike. Eyes and smile are half sunk into the surface, which reads
 * as painted on without z-fighting.
 */
function buildFace(shape: Shape): BufferGeometry {
  const body = new Mesh(BLOB_GEOMETRY[shape]);
  const { y, size } = FACE_ANCHOR[shape];
  const raycaster = new Raycaster();
  const toBody = new Vector3(0, 0, -1);

  function onSurface(x: number, dy: number) {
    raycaster.set(new Vector3(x * size, y + dy * size, 10), toBody);
    const [hit] = raycaster.intersectObject(body);
    if (!hit?.normal) throw new Error(`face point (${x}, ${dy}) misses the ${shape} blob`);
    return { point: hit.point, normal: hit.normal };
  }

  const eyes = [-1, 1].map((side) => {
    const { point, normal } = onSurface(side * EYE_X, EYE_Y);
    const radius = EYE_RADIUS * size;
    return new SphereGeometry(1, 20, 14)
      .scale(radius, radius * 1.15, radius * 0.5)
      .applyQuaternion(new Quaternion().setFromUnitVectors(FORWARD, normal))
      .translate(point.x, point.y, point.z);
  });

  // The lower third of a circle: a small, friendly smile between and below the eyes.
  const smilePath = Array.from({ length: SMILE_SAMPLES + 1 }, (_, i) => {
    const angle = Math.PI * (-5 / 6 + (2 / 3) * (i / SMILE_SAMPLES));
    return onSurface(SMILE_RADIUS * Math.cos(angle), SMILE_Y + SMILE_RADIUS * Math.sin(angle))
      .point;
  });
  const thickness = SMILE_THICKNESS * size;
  const smile = new TubeGeometry(new CatmullRomCurve3(smilePath), 32, thickness, 8);
  // Round the tube's open ends.
  const smileEnds = [smilePath[0], smilePath[SMILE_SAMPLES]].map((p) =>
    new SphereGeometry(thickness, 8, 6).translate(p.x, p.y, p.z),
  );

  return mergeGeometries([...eyes, smile, ...smileEnds]);
}

const FACE_GEOMETRY = Object.fromEntries(SHAPES.map((s) => [s, buildFace(s)])) as Record<
  Shape,
  BufferGeometry
>;

const FACE_MATERIAL = new MeshStandardMaterial({ color: "#2b2620", roughness: 0.35 });

/** Two dot eyes and a smile on the front of a blob. Expressions will follow perception later. */
export default function BlobFace({ shape }: { shape: Shape }) {
  return <mesh geometry={FACE_GEOMETRY[shape]} material={FACE_MATERIAL} receiveShadow />;
}

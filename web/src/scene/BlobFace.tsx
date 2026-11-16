import { MeshStandardMaterial } from "three";
import { FACE_GEOMETRY } from "./blobFaceGeometry.ts";
import type { Shape } from "./blobGeometry.ts";

const FACE_MATERIAL = new MeshStandardMaterial({ color: "#2b2620", roughness: 0.35 });

/** Two dot eyes and a smile on the front of a blob. Expressions will follow perception later. */
export default function BlobFace({ shape }: { shape: Shape }) {
  return <mesh geometry={FACE_GEOMETRY[shape]} material={FACE_MATERIAL} receiveShadow />;
}

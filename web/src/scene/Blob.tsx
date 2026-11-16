import type { ThreeElements } from "@react-three/fiber";
import { MeshStandardMaterial } from "three";
import BlobFace from "./BlobFace.tsx";
import { BLOB_GEOMETRY, type Shape } from "./blobGeometry.ts";
import { blobScale } from "./blobSize.ts";

// The lit mustard sampled from docs/blobs.png. The canvas renders without tone mapping, so a face
// lit head-on shows this exact colour. One base colour for every blob: colour is kept for scores.
const BLOB_YELLOW = "#c8af56";

// Shared by every blob of the same colour.
const bodyMaterials = new Map<string, MeshStandardMaterial>();

function bodyMaterial(color: string) {
  let material = bodyMaterials.get(color);
  if (!material) {
    material = new MeshStandardMaterial({ color, roughness: 0.6 });
    bodyMaterials.set(color, material);
  }
  return material;
}

type BlobProps = Omit<ThreeElements["group"], "scale" | "children"> & {
  shape: Shape;
  age: number;
  /** Any CSS colour. */
  color?: string;
};

/** One blob: its shape is its culture, its size is its age (docs/BLOBS.md). */
export default function Blob({ shape, age, color = BLOB_YELLOW, ...group }: BlobProps) {
  return (
    <group {...group} scale={blobScale(age)}>
      <mesh
        geometry={BLOB_GEOMETRY[shape]}
        material={bodyMaterial(color)}
        castShadow
        receiveShadow
      />
      <BlobFace shape={shape} />
    </group>
  );
}

import type { ThreeElements } from "@react-three/fiber";
import { MeshStandardMaterial } from "three";
import BlobFace from "./BlobFace.tsx";
import { BLOB_GEOMETRY, type Shape } from "./blobGeometry.ts";
import { MOOD_COLOR, type Mood } from "./blobMood.ts";
import { blobScale } from "./blobSize.ts";

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
  mood?: Mood;
};

/** One blob: its shape is its culture, its size is its age (docs/BLOBS.md). */
export default function Blob({ shape, age, mood = "smile", ...group }: BlobProps) {
  return (
    <group {...group} scale={blobScale(age)}>
      <mesh
        geometry={BLOB_GEOMETRY[shape]}
        material={bodyMaterial(MOOD_COLOR[mood])}
        castShadow
        receiveShadow
      />
      <BlobFace shape={shape} mood={mood} />
    </group>
  );
}

import type { Ref } from "react";
import { type Mesh, MeshStandardMaterial } from "three";
import { BROWS, EYES, MOUTHS } from "./blobFaceGeometry.ts";
import type { Shape } from "./blobGeometry.ts";
import { MOOD_FACE, type Mood } from "./blobMood.ts";

const FACE_MATERIAL = new MeshStandardMaterial({ color: "#2b2620", roughness: 0.35 });

/**
 * A mood's face on the front of a blob. The mouth is its own mesh with its origin at the middle
 * of the mouth, so scaling it opens and closes the mouth in place.
 */
export default function BlobFace({
  shape,
  mood,
  mouthRef,
}: {
  shape: Shape;
  mood: Mood;
  mouthRef?: Ref<Mesh>;
}) {
  const face = MOOD_FACE[mood];
  const mouth = MOUTHS[shape][face.mouth];
  return (
    <>
      <mesh geometry={EYES[shape][face.eyes]} material={FACE_MATERIAL} receiveShadow />
      {face.brows && (
        <mesh geometry={BROWS[shape][face.brows]} material={FACE_MATERIAL} receiveShadow />
      )}
      <mesh
        ref={mouthRef}
        geometry={mouth.geometry}
        position={mouth.position}
        quaternion={mouth.quaternion}
        material={FACE_MATERIAL}
        receiveShadow
      />
    </>
  );
}

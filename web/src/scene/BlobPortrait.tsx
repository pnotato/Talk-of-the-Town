import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import Blob from "./Blob.tsx";
import type { Shape } from "./blobGeometry.ts";
import type { Mood } from "./blobMood.ts";
import { PORTRAIT_FOV, portraitFraming } from "./blobPortrait.ts";

/** Aims the camera at the blob, and again whenever the shape or the canvas's proportions change. */
function PortraitCamera({ shape }: { shape: Shape }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.size.width / s.size.height);

  useLayoutEffect(() => {
    const { position, target } = portraitFraming(shape, aspect);
    camera.position.set(...position);
    camera.lookAt(...target);
    invalidate();
  }, [camera, invalidate, shape, aspect]);
  return null;
}

/**
 * A small face-forward portrait of one blob in the given shape, age and mood, for the inspector.
 * It fills its parent, which must have a size.
 *
 * It draws on demand: a frame when the blob or the canvas changes, and none otherwise. There are no
 * shadows, no controls and a capped pixel ratio, so it stays cheap. The canvas (and its WebGL
 * context) lives as long as the portrait does; selecting another blob only swaps what is in it.
 * Blobs share their geometry with the town, so unmounting disposes nothing but the blob's own
 * material.
 */
export default function BlobPortrait({
  shape,
  age,
  mood,
}: {
  shape: Shape;
  age: number;
  mood: Mood;
}) {
  return (
    <div style={{ width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden="true">
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        flat
        camera={{ fov: PORTRAIT_FOV, near: 0.1, far: 50 }}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        // A portrait never moves on the page by itself, so it needn't listen to every scroll.
        resize={{ scroll: false }}
      >
        {/* The same light as the Shapes sandbox, so a mood's colour matches the town's. */}
        <hemisphereLight args={["#eef4fa", "#7d8f6e", 1.6]} />
        <directionalLight position={[5, 10, 6]} intensity={2.4} />
        <PortraitCamera shape={shape} />
        {/* Keyed so a new blob starts out with its own face and colour. A Blob only eases towards
            its mood from frame to frame, and a demand canvas draws no frames in between. */}
        <Blob
          key={`${shape}-${age}-${mood}`}
          id={0}
          shape={shape}
          age={age}
          mood={mood}
          position={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
}

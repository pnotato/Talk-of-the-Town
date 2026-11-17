import { useMemo } from "react";
import type { Vector3Tuple } from "three";
import Blob from "./Blob.tsx";
import { SURFACE } from "./CityGround.tsx";
import type { CrowdBlob } from "./scatterCrowd.ts";

/**
 * The placeholder crowd (scatterCrowd.ts), each blob idling in its mood on its own cell of the
 * plaza, feet on the paving. Reduced motion stills them; Blob handles that.
 */
export function CityCrowd({ crowd }: { crowd: CrowdBlob[] }) {
  // Built once per crowd, so a re-render hands every Blob the same target.
  const positions = useMemo(() => crowd.map((b): Vector3Tuple => [b.x, SURFACE, b.z]), [crowd]);
  return (
    <group>
      {crowd.map((b, i) => (
        <Blob
          key={b.id}
          id={b.id}
          shape={b.shape}
          age={b.age}
          mood={b.mood}
          idle
          position={positions[i]}
          yaw={b.yaw}
        />
      ))}
    </group>
  );
}

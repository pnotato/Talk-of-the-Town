import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { SURFACE } from "./CityGround.tsx";
import type { MapGathering } from "./mapLayout.ts";
import { tileOutlines, tilePositions } from "./plazaGrid.ts";

// A shade off the plain paving, so the grid reads as a laid patch of hex stones from afar and
// the joints between them resolve close up.
const TILE = "#efe7d4";

/**
 * The plaza's standing grid, one hex paving stone round each spot a blob can stand on, cut to
 * the paving. One mesh, one draw call, laid on the paving and pulled in front of it with
 * polygonOffset.
 */
export function CityGrid({ plaza, visible = true }: { plaza: MapGathering; visible?: boolean }) {
  const geometry = useMemo(() => {
    const positions = tilePositions(tileOutlines(plaza.spots, plaza.outline), SURFACE);
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    return g;
  }, [plaza]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} visible={visible} receiveShadow>
      <meshLambertMaterial
        color={TILE}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

import { useEffect, useMemo } from "react";
import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import { SURFACE } from "./CityGround.tsx";
import type { MapGathering } from "./mapLayout.ts";
import { tileOutlines, tilePositions } from "./plazaGrid.ts";

// Each a shade off the ground it is laid on, so the grid reads as a laid patch of hex stones
// from afar and the joints between them resolve close up. On the park's lawn the stones are
// lighter grass, so the park still reads as a lawn.
const TILES: Record<string, string> = {
  plaza: "#efe7d4",
  square: "#efe7d4",
  sidewalk: "#dcd5c6",
  park: "#9dba78",
  // The harbour: pale boards on its decks, and a light lawn on its green.
  boardwalk: "#e8dcc6",
  pier: "#e8dcc6",
  pierhead: "#e8dcc6",
  green: "#bccf9a",
};

/**
 * The walkable grid, one hex stone round each cell a blob can stand on, each area's cut to that
 * area's edge. One mesh, one draw call, laid on the ground and pulled in front of it with
 * polygonOffset.
 */
export function CityGrid({
  gathering,
  visible = true,
}: {
  gathering: MapGathering;
  visible?: boolean;
}) {
  const geometry = useMemo(() => {
    const color = new Color();
    const parts = gathering.areas.map((area) => {
      const positions = tilePositions(tileOutlines(area.spots, area.outline), SURFACE);
      color.set(TILES[area.name] ?? TILES.plaza);
      const colors = new Float32Array(positions.length);
      for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
      return { positions, colors };
    });
    const length = parts.reduce((sum, p) => sum + p.positions.length, 0);
    const positions = new Float32Array(length);
    const colors = new Float32Array(length);
    let at = 0;
    for (const part of parts) {
      positions.set(part.positions, at);
      colors.set(part.colors, at);
      at += part.positions.length;
    }
    const normals = new Float32Array(length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return g;
  }, [gathering]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} visible={visible} receiveShadow>
      <meshLambertMaterial
        vertexColors
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

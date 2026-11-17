import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { layoutTown } from "./layoutTown.ts";
import { RenderResolution } from "./RenderResolution.tsx";
import { TownCamera } from "./TownCamera.tsx";
import { GROUND_RADIUS, TownGround } from "./TownGround.tsx";
import { TownHomes } from "./TownHomes.tsx";
import { TownLights } from "./TownLights.tsx";
import { TownPaths } from "./TownPaths.tsx";
import { TownSquare } from "./TownSquare.tsx";
import { TownTrees } from "./TownTrees.tsx";

// docs/MODEL.md: 53 homes dealt round-robin into 5 neighbourhoods.
const HOMES = 53;
const NEIGHBOURHOODS = 5;

// Sky and fog share one colour, so the fields fade into the sky with no visible edge.
const SKY = "#d4e2ee";

interface Props {
  homeCount?: number;
  neighbourhoodCount?: number;
}

/** The empty town: fields and trees, neighbourhoods of homes, paths and the central square. */
export default function TownScene({
  homeCount = HOMES,
  neighbourhoodCount = NEIGHBOURHOODS,
}: Props) {
  const layout = useMemo(
    () => layoutTown(homeCount, neighbourhoodCount),
    [homeCount, neighbourhoodCount],
  );

  // PCF shadows softened by shadow.radius: R3F's default soft type is gone in three r187.
  // `flat` skips tone mapping so the muted palette stays true to docs/blobs.png.
  // A narrow field of view keeps the far side of the town from shrinking too much.
  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={1}
      camera={{ fov: 30, near: 1, far: GROUND_RADIUS * 1.2 }}
      role="img"
      aria-label={`Town map: ${homeCount} homes in ${neighbourhoodCount} neighbourhoods around a square. Drag to pan, scroll or pinch to zoom.`}
    >
      <RenderResolution />
      <color attach="background" args={[SKY]} />
      <TownLights layout={layout} />
      <TownGround neighbourhoods={layout.neighbourhoods} />
      <TownPaths paths={layout.paths} />
      <TownSquare square={layout.square} />
      <TownHomes homes={layout.homes} />
      <TownTrees trees={layout.trees} />
      <TownCamera layout={layout} fogColor={SKY} />
    </Canvas>
  );
}

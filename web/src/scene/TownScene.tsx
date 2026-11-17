import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { layoutTown } from "./layoutTown.ts";
import { MapCamera } from "./MapCamera.tsx";
import { MapLights } from "./MapLights.tsx";
import { RenderResolution } from "./RenderResolution.tsx";
import { GROUND_RADIUS, TownGround } from "./TownGround.tsx";
import { TownHomes } from "./TownHomes.tsx";
import { TownPaths } from "./TownPaths.tsx";
import { TownSquare } from "./TownSquare.tsx";
import { townMap } from "./townMap.ts";
import { TownTrees } from "./TownTrees.tsx";

// docs/MODEL.md: 53 homes dealt round-robin into 5 neighbourhoods.
const HOMES = 53;
const NEIGHBOURHOODS = 5;
// Close enough to see a doorstep; at the camera's lowest tilt it stays above every roof.
const MIN_DISTANCE = 10;

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
  const map = useMemo(() => townMap(layout), [layout]);

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
      <MapLights map={map} />
      <TownGround neighbourhoods={layout.neighbourhoods} />
      <TownPaths paths={layout.paths} />
      <TownSquare square={layout.square} />
      <TownHomes homes={layout.homes} />
      <TownTrees trees={layout.trees} />
      <MapCamera map={map} minDistance={MIN_DISTANCE} fogColor={SKY} />
    </Canvas>
  );
}

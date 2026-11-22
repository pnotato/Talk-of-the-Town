import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { MathUtils } from "three";
import { layoutTown } from "./layoutTown.ts";
import { MapCamera } from "./MapCamera.tsx";
import { MapLights } from "./MapLights.tsx";
import { RenderResolution } from "./RenderResolution.tsx";
import { TownDowntown } from "./TownDowntown.tsx";
import { GROUND_RADIUS, TownGround } from "./TownGround.tsx";
import { TownHomes } from "./TownHomes.tsx";
import { townMap } from "./townMap.ts";
import { TownSquare } from "./TownSquare.tsx";
import { TownTrees } from "./TownTrees.tsx";

// docs/MODEL.md: 53 homes dealt round-robin into 5 neighbourhoods.
const HOMES = 53;
const NEIGHBOURHOODS = 5;
// Close enough to see a doorstep; the camera floor keeps it out of the roofs and the tower.
const MIN_DISTANCE = 10;
// Tilted right down, the camera looks across the square at the screen from about a crowd's
// eye level, round a point a little off the ground.
const LOWEST_TILT = MathUtils.degToRad(88);
const EYE_HEIGHT = 3;

// Sky and fog share one colour, so the fields fade into the sky with no visible edge.
const SKY = "#d4e2ee";

interface Props {
  homeCount?: number;
  neighbourhoodCount?: number;
}

/**
 * The empty town: a square with a news screen, the town hall and Main Street's shops round it,
 * neighbourhoods of homes on a grid of streets, and fields and trees beyond.
 */
export default function TownScene({
  homeCount = HOMES,
  neighbourhoodCount = NEIGHBOURHOODS,
}: Props) {
  const town = useMemo(
    () => layoutTown(homeCount, neighbourhoodCount),
    [homeCount, neighbourhoodCount],
  );
  const map = useMemo(() => townMap(town), [town]);

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
      aria-label={`Town map: ${homeCount} homes in ${neighbourhoodCount} neighbourhoods round a town square with a news screen, the town hall and Main Street. Drag to pan, scroll or pinch to zoom.`}
    >
      <RenderResolution />
      <color attach="background" args={[SKY]} />
      <MapLights map={map} />
      <TownGround town={town} />
      <TownSquare town={town} />
      <TownDowntown buildings={town.buildings} />
      <TownHomes homes={town.homes} />
      <TownTrees trees={town.trees} />
      <MapCamera
        map={map}
        minDistance={MIN_DISTANCE}
        maxPolar={LOWEST_TILT}
        targetHeight={EYE_HEIGHT}
        fogColor={SKY}
      />
    </Canvas>
  );
}

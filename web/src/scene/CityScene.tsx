import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { MathUtils } from "three";
import { CityBuildings } from "./CityBuildings.tsx";
import { CityCrowd } from "./CityCrowd.tsx";
import { CityGrid } from "./CityGrid.tsx";
import { CityGround } from "./CityGround.tsx";
import { CityScreens } from "./CityScreens.tsx";
import { CityStreetLife } from "./CityStreetLife.tsx";
import { layoutCity } from "./layoutCity.ts";
import { gatheringSpots } from "./mapLayout.ts";
import { MapCamera } from "./MapCamera.tsx";
import { MapLights } from "./MapLights.tsx";
import { RenderResolution } from "./RenderResolution.tsx";
import { CROWD_SIZE, DEFAULT_CROWD_SEED, scatterCrowd } from "./scatterCrowd.ts";
import { GROUND_RADIUS } from "./TownGround.tsx";
import { TownTrees } from "./TownTrees.tsx";

// docs/MODEL.md: 53 homes dealt round-robin into 5 neighbourhoods.
const HOMES = 53;
const NEIGHBOURHOODS = 5;

const CLOSEST = 12;
const LOWEST_TILT = MathUtils.degToRad(95); // a touch past level, to look up at the screens
const EYE_HEIGHT = 4;

// The town's sky, so both maps feel like one game.
const SKY = "#d4e2ee";

interface Props {
  homeCount?: number;
  neighbourhoodCount?: number;
  /** Seeds the placeholder crowd on the walkable grid (scatterCrowd.ts). */
  crowdSeed?: number;
  /** Draw the walkable grid. */
  showGrid?: boolean;
}

/**
 * The city: a plaza ringed by news screens, districts of apartments, streets and traffic, and a
 * placeholder crowd standing on the walkable grid (the plaza, the park and the sidewalks round
 * them) until there is a sim to replay.
 */
export default function CityScene({
  homeCount = HOMES,
  neighbourhoodCount = NEIGHBOURHOODS,
  crowdSeed = DEFAULT_CROWD_SEED,
  showGrid = true,
}: Props) {
  const city = useMemo(
    () => layoutCity(homeCount, neighbourhoodCount),
    [homeCount, neighbourhoodCount],
  );
  const crowd = useMemo(
    () => scatterCrowd(crowdSeed, gatheringSpots(city.gathering), CROWD_SIZE),
    [crowdSeed, city],
  );

  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={1}
      camera={{ fov: 30, near: 1, far: GROUND_RADIUS * 1.2 }}
      role="img"
      aria-label={`City map: ${homeCount} homes in ${neighbourhoodCount} districts around a plaza of news screens. A placeholder crowd of ${crowd.length} blobs stands on the plaza, the park and the sidewalks${showGrid ? ", on a grid of hex stones" : ""}. Drag to pan, scroll or pinch to zoom.`}
    >
      <RenderResolution />
      <color attach="background" args={[SKY]} />
      <MapLights map={city} />
      <CityGround city={city} />
      <CityGrid gathering={city.gathering} visible={showGrid} />
      {/* A new seed is a new crowd: remount it rather than walk everyone across the city. */}
      <CityCrowd key={crowdSeed} crowd={crowd} />
      <CityBuildings city={city} />
      <CityScreens city={city} />
      <CityStreetLife city={city} />
      <TownTrees trees={city.trees} />
      {/* Close enough to see faces; the camera floor keeps it out of the towers. It orbits a
          point a few units up, so tilted low it looks across the plaza at the screens. */}
      <MapCamera
        map={city}
        minDistance={CLOSEST}
        maxPolar={LOWEST_TILT}
        targetHeight={EYE_HEIGHT}
        fogColor={SKY}
      />
    </Canvas>
  );
}

import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { MathUtils } from "three";
import { CityBuildings } from "./CityBuildings.tsx";
import { CityGround } from "./CityGround.tsx";
import { CityScreens } from "./CityScreens.tsx";
import { CityStreetLife } from "./CityStreetLife.tsx";
import { layoutCity } from "./layoutCity.ts";
import { MapCamera } from "./MapCamera.tsx";
import { MapLights } from "./MapLights.tsx";
import { RenderResolution } from "./RenderResolution.tsx";
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
}

/** The city: a plaza ringed by news screens, districts of apartments, streets and traffic. */
export default function CityScene({
  homeCount = HOMES,
  neighbourhoodCount = NEIGHBOURHOODS,
}: Props) {
  const city = useMemo(
    () => layoutCity(homeCount, neighbourhoodCount),
    [homeCount, neighbourhoodCount],
  );

  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={1}
      camera={{ fov: 30, near: 1, far: GROUND_RADIUS * 1.2 }}
      role="img"
      aria-label={`City map: ${homeCount} homes in ${neighbourhoodCount} districts around a plaza of news screens. Drag to pan, scroll or pinch to zoom.`}
    >
      <RenderResolution />
      <color attach="background" args={[SKY]} />
      <MapLights map={city} />
      <CityGround city={city} />
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

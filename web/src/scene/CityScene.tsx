import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { CityBuildings } from "./CityBuildings.tsx";
import { CityGround } from "./CityGround.tsx";
import { CityScreens } from "./CityScreens.tsx";
import { CityStreetLife } from "./CityStreetLife.tsx";
import { layoutCity } from "./layoutCity.ts";
import { MapCamera } from "./MapCamera.tsx";
import { MapLights } from "./MapLights.tsx";
import { GROUND_RADIUS } from "./TownGround.tsx";
import { TownTrees } from "./TownTrees.tsx";

// docs/MODEL.md: 53 homes dealt round-robin into 5 neighbourhoods.
const HOMES = 53;
const NEIGHBOURHOODS = 5;

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
      dpr={[1, 2]}
      camera={{ fov: 30, near: 1, far: GROUND_RADIUS * 1.2 }}
      role="img"
      aria-label={`City map: ${homeCount} homes in ${neighbourhoodCount} districts around a plaza of news screens. Drag to pan, scroll or pinch to zoom.`}
    >
      <color attach="background" args={[SKY]} />
      <MapLights map={city} />
      <CityGround city={city} />
      <CityBuildings city={city} />
      <CityScreens city={city} />
      <CityStreetLife city={city} />
      <TownTrees trees={city.trees} />
      {/* Fully zoomed in at the lowest tilt, the camera still clears the tallest roof. */}
      <MapCamera map={city} clearance={city.height + 2} fogColor={SKY} />
    </Canvas>
  );
}

import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { MathUtils } from "three";
import type { RunLog } from "../generated/types.ts";
import { CityBuildings } from "./CityBuildings.tsx";
import { CityGrid } from "./CityGrid.tsx";
import { CityGround } from "./CityGround.tsx";
import { CityReplay } from "./CityReplay.tsx";
import { CityScreens } from "./CityScreens.tsx";
import { CityStreetLife } from "./CityStreetLife.tsx";
import { CITY_HOMES, CITY_NEIGHBOURHOODS, layoutCity } from "./layoutCity.ts";
import { MapCamera } from "./MapCamera.tsx";
import { MapLights } from "./MapLights.tsx";
import { RenderResolution } from "./RenderResolution.tsx";
import { GROUND_RADIUS } from "./TownGround.tsx";
import { TownTrees } from "./TownTrees.tsx";

const CLOSEST = 12;
const LOWEST_TILT = MathUtils.degToRad(95); // a touch past level, to look up at the screens
const EYE_HEIGHT = 4;

// The town's sky, so both maps feel like one game.
const SKY = "#d4e2ee";

interface Props {
  homeCount?: number;
  neighbourhoodCount?: number;
  /** The run to replay; null while it loads, and the city stands empty. */
  run: RunLog | null;
  playing: boolean;
  /** How many times faster than real time the replay plays. */
  speed: number;
  /** Draw the walkable grid. */
  showGrid?: boolean;
  /** Called with the index of the round whose walk is playing, each time it changes. */
  onRound?: (round: number) => void;
  /** Called once when the replay reaches the end of the run while playing. */
  onEnd?: () => void;
}

/**
 * The city: a plaza ringed by news screens, districts of apartments, streets and traffic, and the
 * town walking the plaza, the park and the sidewalks round them as the sim moved it.
 */
export default function CityScene({
  homeCount = CITY_HOMES,
  neighbourhoodCount = CITY_NEIGHBOURHOODS,
  run,
  playing,
  speed,
  showGrid = true,
  onRound,
  onEnd,
}: Props) {
  const city = useMemo(
    () => layoutCity(homeCount, neighbourhoodCount),
    [homeCount, neighbourhoodCount],
  );
  const crowd = run
    ? `${run.town.blobs.length} blobs walk the plaza, the park and the sidewalks as a simulated run plays out, their faces and colours showing what each thinks of the company.`
    : "The simulated run is loading.";

  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={1}
      camera={{ fov: 30, near: 1, far: GROUND_RADIUS * 1.2 }}
      role="img"
      aria-label={`City map: ${homeCount} homes in ${neighbourhoodCount} districts around a plaza of news screens. ${crowd}${showGrid ? " The walkable ground is laid with hex stones." : ""} Drag to pan, scroll or pinch to zoom.`}
    >
      <RenderResolution />
      <color attach="background" args={[SKY]} />
      <MapLights map={city} />
      <CityGround city={city} />
      <CityGrid gathering={city.gathering} visible={showGrid} />
      {/* A new run starts afresh rather than walking everyone across the city. */}
      {run && (
        <CityReplay
          key={run.seed}
          run={run}
          playing={playing}
          speed={speed}
          onRound={onRound}
          onEnd={onEnd}
        />
      )}
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

import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { MathUtils } from "three";
import type { RunLog } from "../generated/types.ts";
import { CityGrid } from "./CityGrid.tsx";
import { SURFACE } from "./CityGround.tsx";
import { CityReplay } from "./CityReplay.tsx";
import { layoutTown, TOWN_HOMES, TOWN_NEIGHBOURHOODS } from "./layoutTown.ts";
import { MapCamera } from "./MapCamera.tsx";
import { MapLights } from "./MapLights.tsx";
import { RenderResolution } from "./RenderResolution.tsx";
import { TownDowntown } from "./TownDowntown.tsx";
import { GROUND_RADIUS, TownGround, TOWN_SURFACE } from "./TownGround.tsx";
import { TownHomes } from "./TownHomes.tsx";
import { townMap } from "./townMap.ts";
import { TownSquare } from "./TownSquare.tsx";
import { TownTrees } from "./TownTrees.tsx";

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
  /** The run to replay; null while it loads, and the town stands empty. */
  run?: RunLog | null;
  playing?: boolean;
  /** How many times faster than real time the replay plays. */
  speed?: number;
  /** Draw the walkable grid. */
  showGrid?: boolean;
  /** Called with the index of the round whose walk is playing, each time it changes. */
  onRound?: (round: number) => void;
  /** Called once when the replay reaches the end of the run while playing. */
  onEnd?: () => void;
}

/**
 * The town: a square with a news screen, the town hall and Main Street's shops round it,
 * neighbourhoods of homes on a grid of streets, and fields and trees beyond. With a run it also
 * draws the walkable grid and the town walking the square, exactly as the city does.
 */
export default function TownScene({
  homeCount = TOWN_HOMES,
  neighbourhoodCount = TOWN_NEIGHBOURHOODS,
  run = null,
  playing = false,
  speed = 1,
  showGrid = false,
  onRound,
  onEnd,
}: Props) {
  const town = useMemo(
    () => layoutTown(homeCount, neighbourhoodCount),
    [homeCount, neighbourhoodCount],
  );
  const map = useMemo(() => townMap(town), [town]);
  const crowd = run
    ? `${run.town.blobs.length} blobs walk the square as a simulated run plays out, their faces and colours showing what each thinks of the company.`
    : "The simulated run is loading.";

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
      aria-label={
        run
          ? `Town map: ${homeCount} homes in ${neighbourhoodCount} neighbourhoods round a town square with a news screen, the town hall and Main Street. ${crowd}${showGrid ? " The walkable ground is laid with hex stones." : ""} Drag or use W, A, S and D to pan, scroll or pinch to zoom.`
          : `Town map: ${homeCount} homes in ${neighbourhoodCount} neighbourhoods round a town square with a news screen, the town hall and Main Street. Drag or use W, A, S and D to pan, scroll or pinch to zoom.`
      }
    >
      <RenderResolution />
      <color attach="background" args={[SKY]} />
      <MapLights map={map} />
      <TownGround town={town} />
      {/* The city's grid and replay sit on the city's paving; lift them onto the town's. */}
      <group position={[0, TOWN_SURFACE - SURFACE, 0]}>
        <CityGrid gathering={map.gathering} visible={showGrid} />
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
      </group>
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

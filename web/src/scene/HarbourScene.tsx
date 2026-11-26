import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useMemo, useRef } from "react";
import { MathUtils } from "three";
import type { RunLog } from "../generated/types.ts";
import type { BlobActivity } from "../inspector/inspectorModel.ts";
import { CityGrid } from "./CityGrid.tsx";
import { SURFACE } from "./CityGround.tsx";
import { CityReplay } from "./CityReplay.tsx";
import { HarbourBoats } from "./HarbourBoats.tsx";
import { HarbourDecks } from "./HarbourDecks.tsx";
import { HarbourFireworks } from "./HarbourFireworks.tsx";
import { HarbourFestival } from "./HarbourFestival.tsx";
import { HarbourLand } from "./HarbourLand.tsx";
import { HarbourLighthouse } from "./HarbourLighthouse.tsx";
import { harbourMap } from "./harbourMap.ts";
import { createFireworkQueue, FIREWORK_COLOURS, launchFirework } from "./harbourMotion.ts";
import type { Startle } from "./harbourToys.ts";
import { HarbourRides } from "./HarbourRides.tsx";
import { HarbourScreen } from "./HarbourScreen.tsx";
import { HarbourSky, type SkyColours } from "./HarbourSky.tsx";
import { HarbourTrees } from "./HarbourTrees.tsx";
import { HarbourVillage } from "./HarbourVillage.tsx";
import { HarbourWater } from "./HarbourWater.tsx";
import { useReducedMotion } from "./blobMedia.ts";
import {
  HARBOUR_HOMES,
  HARBOUR_NEIGHBOURHOODS,
  HARBOUR_SURFACE,
  type HarbourLayout,
  layoutHarbour,
} from "./layoutHarbour.ts";
import { MapCamera } from "./MapCamera.tsx";
import { type LightColours, MapLights } from "./MapLights.tsx";
import { RenderResolution } from "./RenderResolution.tsx";
import { GROUND_RADIUS } from "./TownGround.tsx";

// Close enough to see a face; the camera floor keeps it out of the wheel and the roofs.
const MIN_DISTANCE = 10;
// Tilted right down, the camera looks out across the bay to the horizon, round a point a little
// off the ground.
const LOWEST_TILT = MathUtils.degToRad(92);
const EYE_HEIGHT = 3;

// The fog, the far water and the sky meet at the horizon in one colour, so the lake has no edge.
const SKY: SkyColours = { horizon: "#dde8ee", zenith: "#a9c9e6", glow: "#fbe3c4" };
// A late-summer afternoon: the sun a touch golden, the bounce off the grass a touch warm.
const LIGHT: LightColours = { sky: "#e1ecf7", ground: "#98946f", sun: "#fff0d8" };

interface Props {
  /** The run to replay; null while it loads, and the harbour stands empty. */
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
  /** The blob to ring, if the page has a selection. */
  selectedId?: number | null;
  /** Makes every blob clickable; called with the clicked blob's id. */
  onSelect?: (id: number) => void;
  /** Called when the round or the completed-round count changes, with everyone's activity. */
  onActivities?: (updates: Record<number, BlobActivity>) => void;
}

/** Fireworks from wherever the player clicks the water; they also startle the gulls. */
function Show({ harbour, startleRef }: { harbour: HarbourLayout; startleRef: Startle }) {
  const clock = useThree((s) => s.clock);
  const still = useReducedMotion();
  const queue = useMemo(() => createFireworkQueue(), []);
  const launch = useCallback(
    (x: number, z: number) => {
      const now = clock.elapsedTime;
      launchFirework(queue, x, z, now, FIREWORK_COLOURS.length);
      startleRef.current = now;
    },
    [clock, queue, startleRef],
  );
  return (
    <>
      <HarbourWater harbour={harbour} onLaunch={still ? undefined : launch} />
      <HarbourFireworks queue={queue} />
    </>
  );
}

/**
 * The harbour on a festival day: a boardwalk along the sea wall, a pier out to a ferris wheel, the
 * festival green with its carousel and market, and the bay with its boats, lighthouse and floating
 * news screen. With a run, the town walks the green, the boardwalk, the pier and the pier head,
 * exactly as it walks the city. The player can play: click the water for fireworks, and the
 * ferris wheel, the carousel, the lighthouse, the bell, the kites and the sailboats to set them
 * going.
 */
export default function HarbourScene({
  run = null,
  playing = false,
  speed = 1,
  showGrid = false,
  onRound,
  onEnd,
  selectedId = null,
  onSelect,
  onActivities,
}: Props) {
  const harbour = useMemo(() => layoutHarbour(HARBOUR_HOMES, HARBOUR_NEIGHBOURHOODS), []);
  const map = useMemo(() => harbourMap(harbour), [harbour]);
  // Shared by the fireworks, the lighthouse's horn and the gulls they scatter.
  const startleRef = useRef(-Infinity);
  const crowd = run
    ? ` ${run.town.blobs.length} blobs walk the green, the boardwalk and the pier as a simulated run plays out, their faces and colours showing what each thinks of the company.`
    : " The simulated run is loading.";

  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={1}
      camera={{ fov: 30, near: 1, far: GROUND_RADIUS * 1.2 }}
      role="img"
      aria-label={`Harbour map: a festival day by the lake. A boardwalk runs along the sea wall, a pier leads out to a ferris wheel, and a green with a carousel and market stalls lies behind; boats, a lighthouse and a floating news screen fill the bay, with ${HARBOUR_HOMES} clapboard homes beyond.${crowd}${showGrid ? " The walkable ground is laid with hex stones." : ""} Drag or use W, A, S and D to pan, scroll or pinch to zoom. Click the water for fireworks, or the ferris wheel, carousel, lighthouse, bell, kites and sailboats to set them going.`}
    >
      <RenderResolution />
      <color attach="background" args={[SKY.horizon]} />
      <MapLights map={map} colours={LIGHT} />
      <HarbourSky colours={SKY} startleRef={startleRef} />
      <HarbourLand harbour={harbour} />
      <Show harbour={harbour} startleRef={startleRef} />
      <HarbourDecks harbour={harbour} />
      {/* The city's grid and replay sit on the city's paving; lift them onto the decks. */}
      <group position={[0, HARBOUR_SURFACE - SURFACE, 0]}>
        <CityGrid gathering={map.gathering} visible={showGrid} />
        {run && (
          <CityReplay
            key={run.seed}
            run={run}
            playing={playing}
            speed={speed}
            onRound={onRound}
            onEnd={onEnd}
            selectedId={selectedId}
            onSelect={onSelect}
            onActivities={onActivities}
          />
        )}
      </group>
      <HarbourFestival harbour={harbour} />
      <HarbourRides harbour={harbour} />
      <HarbourLighthouse harbour={harbour} startleRef={startleRef} />
      <HarbourScreen harbour={harbour} />
      <HarbourBoats harbour={harbour} />
      <HarbourVillage homes={harbour.homes} />
      <HarbourTrees trees={harbour.trees} />
      <MapCamera
        map={map}
        minDistance={MIN_DISTANCE}
        maxPolar={LOWEST_TILT}
        targetHeight={EYE_HEIGHT}
        fogColor={SKY.horizon}
      />
    </Canvas>
  );
}

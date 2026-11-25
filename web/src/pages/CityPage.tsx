import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunLog } from "../generated/types.ts";
import GameHud from "../hud/GameHud.tsx";
import { MAPS, type MapName } from "../hud/settings.ts";
import { BlobSelectionProvider, useBlobSelection } from "../inspector/BlobSelection.tsx";
import { cityCatalog, EMPTY_CITY_CATALOG } from "../inspector/cityProfiles.ts";
import { useReducedMotion } from "../scene/blobMedia.ts";
import CityScene from "../scene/CityScene.tsx";
import HarbourScene from "../scene/HarbourScene.tsx";
import TownScene from "../scene/TownScene.tsx";

const FIRST_SEED = 1;
// A run asks for one announcement every 10 rounds, so a server still asking after this many is
// broken; stop rather than ask forever.
const MAX_ANNOUNCEMENTS = 50;

const UNREACHABLE = "Can't reach the sim server. Start it with make dev.";

/** The server answered, but refused the run; the message says why. */
class RunRefused extends Error {}

/**
 * Plays the run for `seed` to the end, the way the newsroom will: POST the choices so far, and
 * while the sim stops at an announcement with no choice yet, pick one and ask again. Until the
 * newsroom exists, it always picks the first option.
 */
async function fetchRun(seed: number, map: MapName, signal: AbortSignal): Promise<RunLog> {
  const choices: string[] = [];
  while (choices.length <= MAX_ANNOUNCEMENTS) {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed, choices, map }),
      signal,
    });
    // The Vite proxy answers 5xx when the Go server is down.
    if (response.status >= 400 && response.status < 500) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new RunRefused(body.error ?? `HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const run = (await response.json()) as RunLog;
    if (run.next === null) return run;
    choices.push(run.next.options[0].id);
  }
  throw new RunRefused("the sim kept asking for announcements");
}

type Result = { key: string; run: RunLog } | { key: string; error: string };

/**
 * A map replaying the run, inside the selection provider: it rings the selected blob, makes every
 * blob clickable, and reports what they are doing for the inspector. Every map shares it.
 */
function MapStage({
  map,
  run,
  playing,
  speed,
  showGrid,
  onRound,
  onEnd,
}: {
  map: MapName;
  run: RunLog | null;
  playing: boolean;
  speed: number;
  showGrid: boolean;
  onRound: (round: number) => void;
  onEnd: () => void;
}) {
  const { selectedId, selectBlob, updateActivities } = useBlobSelection();
  const props = {
    run,
    playing,
    speed,
    showGrid,
    onRound,
    onEnd,
    selectedId,
    onSelect: selectBlob,
    onActivities: updateActivities,
  };
  if (map === "town") return <TownScene {...props} />;
  if (map === "harbour") return <HarbourScene {...props} />;
  return <CityScene {...props} />;
}

/**
 * The city replaying a simulated run: the town walks the streets as the sim moved it, and moods
 * change as each round's talk lands. Fetches the run for the seed, then plays it.
 */
export default function CityPage() {
  const reduceMotion = useReducedMotion();
  const [seed, setSeed] = useState(FIRST_SEED);
  const [attempt, setAttempt] = useState(0);
  const [map, setMap] = useState<MapName>("city");
  const [result, setResult] = useState<Result | null>(null);
  const [playing, setPlaying] = useState(!reduceMotion);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [round, setRound] = useState(0);
  const [grid, setGrid] = useState(true);

  useEffect(() => {
    const key = `${seed}/${attempt}/${map}`;
    const controller = new AbortController();
    fetchRun(seed, map, controller.signal).then(
      (run) => {
        if (!controller.signal.aborted) setResult({ key, run });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof RunRefused ? `The sim server refused the run: ${error.message}` : null;
        setResult({ key, error: message ?? UNREACHABLE });
      },
    );
    return () => controller.abort();
  }, [seed, attempt, map]);

  // Until the result for this seed, attempt and map arrives, the page is loading.
  const current = result?.key === `${seed}/${attempt}/${map}` ? result : null;
  const run = current && "run" in current ? current.run : null;
  const error = current && "error" in current ? current.error : null;

  const handleEnd = useCallback(() => {
    setPlaying(false);
    setEnded(true);
  }, []);
  const togglePlay = () => {
    setEnded(false);
    setPlaying((p) => ended || !p);
  };
  const newSeed = () => {
    setSeed((s) => s + 1);
    setRound(0);
    setEnded(false);
    setPlaying(!reduceMotion);
  };
  const chooseMap = (next: MapName) => {
    if (next === map) return;
    setMap(next);
    setRound(0);
    setEnded(false);
    setPlaying(!reduceMotion);
  };

  // The inspector's blob directory for this run; empty until the run arrives.
  const catalog = useMemo(() => (run ? cityCatalog(run) : EMPTY_CITY_CATALOG), [run]);

  return (
    <section
      aria-label={`${MAPS.find((m) => m.id === map)?.label ?? "City"} replay`}
      style={{ position: "relative", height: "100%" }}
    >
      <BlobSelectionProvider catalog={catalog}>
        <MapStage
          map={map}
          run={run}
          playing={playing}
          speed={speed}
          showGrid={grid}
          onRound={setRound}
          onEnd={handleEnd}
        />
        <GameHud
          run={run}
          error={error}
          onRetry={() => setAttempt((a) => a + 1)}
          round={round}
          ended={ended}
          playing={playing}
          onTogglePlay={togglePlay}
          speed={speed}
          onSpeed={setSpeed}
          map={map}
          onMap={chooseMap}
          seed={seed}
          onNewSeed={newSeed}
          grid={grid}
          onGrid={setGrid}
        />
      </BlobSelectionProvider>
    </section>
  );
}

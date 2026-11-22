import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "../scene/blobMedia.ts";
import CityScene from "../scene/CityScene.tsx";
import type { WalkRun } from "../scene/replay.ts";

const FIRST_SEED = 1;
const SPEEDS = [1, 2, 4] as const;
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
async function fetchRun(seed: number, signal: AbortSignal): Promise<WalkRun> {
  const choices: string[] = [];
  while (choices.length <= MAX_ANNOUNCEMENTS) {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed, choices }),
      signal,
    });
    // The Vite proxy answers 5xx when the Go server is down.
    if (response.status >= 400 && response.status < 500) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new RunRefused(body.error ?? `HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const run = (await response.json()) as WalkRun;
    if (run.next === null) return run;
    choices.push(run.next.options[0].id);
  }
  throw new RunRefused("the sim kept asking for announcements");
}

// Bottom right, over the fields at the city's edge and clear of the app shell's SIMULATED badge
// and nav at the top left, even on a phone.
const corner: CSSProperties = {
  position: "absolute",
  bottom: 16,
  right: 16,
  maxWidth: "min(560px, calc(100% - 32px))",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 8,
  font: "14px/1.3 system-ui, sans-serif",
};

const card: CSSProperties = {
  boxSizing: "border-box",
  maxWidth: "100%",
  margin: 0,
  padding: "6px 10px",
  borderRadius: 8,
  background: "rgb(255 255 255 / 0.9)",
  boxShadow: "0 1px 2px rgb(0 0 0 / 0.15)",
};

const panel: CSSProperties = {
  ...card,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 12,
};

// Over the middle of the city while there is nothing to replay.
const notice: CSSProperties = {
  ...card,
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  maxWidth: "calc(100% - 32px)",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "10px 14px",
  font: "15px/1.4 system-ui, sans-serif",
};

const MUTED = "#57606a"; // 6:1 on the white panels

const button: CSSProperties = { font: "inherit", padding: "2px 10px", cursor: "pointer" };

// The chosen speed is bold and outlined, not only a different colour.
const speedButton = (chosen: boolean): CSSProperties => ({
  ...button,
  padding: "2px 8px",
  fontWeight: chosen ? 700 : 400,
  border: chosen ? "2px solid #1f2328" : "1px solid #8c959f",
  borderRadius: 4,
  background: chosen ? "#d8dee4" : "#fff",
  color: "#1f2328",
});

type Result = { key: string; run: WalkRun } | { key: string; error: string };

/**
 * The city replaying a simulated run: the town walks the streets as the sim moved it, and moods
 * change as each round's talk lands. Fetches the run for the seed, then plays it.
 */
export default function CityPage() {
  const reduceMotion = useReducedMotion();
  const [seed, setSeed] = useState(FIRST_SEED);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [playing, setPlaying] = useState(!reduceMotion);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [round, setRound] = useState(0);
  const [grid, setGrid] = useState(true);

  useEffect(() => {
    const key = `${seed}/${attempt}`;
    const controller = new AbortController();
    fetchRun(seed, controller.signal).then(
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
  }, [seed, attempt]);

  // Until the result for this seed and attempt arrives, the page is loading.
  const current = result?.key === `${seed}/${attempt}` ? result : null;
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

  const headline = run?.moments.findLast((m) => m.round <= round)?.headline;

  return (
    <section aria-label="City" style={{ position: "relative", height: "100%" }}>
      <CityScene
        run={run}
        playing={playing}
        speed={speed}
        showGrid={grid}
        onRound={setRound}
        onEnd={handleEnd}
      />
      {!current && (
        <p role="status" style={notice}>
          Simulating…
        </p>
      )}
      {error && (
        <div role="alert" style={notice}>
          <span>{error}</span>
          <button type="button" style={button} onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </div>
      )}
      <div style={corner}>
        {run && (
          <p style={card}>
            {headline && (
              <>
                <strong>News:</strong> {headline}
                <br />
              </>
            )}
            <span style={{ color: MUTED }}>
              Announcements are auto-picked (the first option) until the newsroom exists.
            </span>
          </p>
        )}
        <div role="group" aria-label="Replay" style={panel}>
          <button
            type="button"
            style={{ ...button, minWidth: "5.5em" }}
            disabled={!run}
            onClick={togglePlay}
          >
            {ended ? "Replay" : playing ? "Pause" : "Play"}
          </button>
          <span aria-live="polite" style={{ fontVariantNumeric: "tabular-nums" }}>
            {run ? `Round ${round + 1} / ${run.rounds.length}` : ""}
          </span>
          <span role="group" aria-label="Speed" style={{ display: "flex", gap: 4 }}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                style={speedButton(speed === s)}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </span>
          <button type="button" style={button} onClick={newSeed}>
            New seed
          </button>
          <span style={{ color: MUTED }}>Seed {seed}</span>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
            Grid
          </label>
        </div>
      </div>
    </section>
  );
}

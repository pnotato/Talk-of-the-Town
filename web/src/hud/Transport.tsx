import { useMemo } from "react";
import type { RunLog } from "../generated/types.ts";
import { PauseIcon, PlayIcon, ReplayIcon } from "./icons.tsx";
import { nextSpeed } from "./settings.ts";
import {
  markersAt,
  pulseAt,
  pulseDomain,
  pulseSeries,
  roundShare,
  roundsDoneAt,
  sparkPath,
} from "./timeline.ts";

// The chart's drawing units. The SVG stretches to the bar, and its strokes don't scale with it.
const CHART_WIDTH = 400;
const CHART_HEIGHT = 30;

/**
 * The playback bar, bottom centre: play, the round, the town's two scores and speed. Its track is
 * also the run's chart: the town's average perception and interest drawn round by round as the
 * replay plays, with a mark where each announcement lands. Past announcements carry their headline
 * as a tooltip; ones still to come stay unnamed.
 */
export default function Transport({
  run,
  round,
  ended,
  playing,
  speed,
  onTogglePlay,
  onSpeed,
}: {
  run: RunLog | null;
  /** The index of the round whose walk is playing. */
  round: number;
  ended: boolean;
  playing: boolean;
  speed: number;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
}) {
  const series = useMemo(() => (run ? pulseSeries(run) : null), [run]);
  const domain = useMemo(() => (series ? pulseDomain(series) : undefined), [series]);
  const total = run?.rounds.length ?? 0;
  const done = roundsDoneAt(round, ended, total);
  const pulse = series ? pulseAt(series, done) : null;
  const markers = run ? markersAt(run, round) : [];
  const head = `${roundShare(done, total) * 100}%`;
  const playLabel = ended ? "Replay from the start" : playing ? "Pause" : "Play";

  return (
    <div className="hud-transport hud-glass" role="group" aria-label="Playback">
      <button
        type="button"
        className="transport-play"
        disabled={!run}
        aria-label={playLabel}
        onClick={onTogglePlay}
      >
        {ended ? <ReplayIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className="transport-body">
        <div className="transport-meta">
          <span className="transport-round">
            {run ? (
              <>
                Round <strong>{Math.min(round + 1, total)}</strong>
                <span className="transport-of"> / {total}</span>
              </>
            ) : (
              "Simulating…"
            )}
          </span>
          {pulse && (
            <span className="transport-pulse">
              <span className="pulse pulse-perception">
                <span className="pulse-key" aria-hidden />
                <span className="pulse-label">Perception</span>
                <strong>{pulse.perception}</strong>
              </span>
              <span className="pulse pulse-interest">
                <span className="pulse-key" aria-hidden />
                <span className="pulse-label">Interest</span>
                <strong>{pulse.interest}</strong>
              </span>
            </span>
          )}
        </div>

        <div
          className="transport-track"
          role="img"
          aria-label={
            pulse
              ? `Town averages so far: perception ${pulse.perception}, interest ${pulse.interest} out of 100, after ${done} of ${total} rounds.`
              : "Town averages appear once the run loads."
          }
        >
          <span className="track-played" style={{ width: head }} aria-hidden />
          {series && (
            <svg
              className="track-chart"
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <path
                className="spark spark-interest"
                d={sparkPath(series.interest, done, total, CHART_WIDTH, CHART_HEIGHT, domain)}
              />
              <path
                className="spark spark-perception"
                d={sparkPath(series.perception, done, total, CHART_WIDTH, CHART_HEIGHT, domain)}
              />
            </svg>
          )}
          {markers.map((m) => (
            <span
              key={m.id}
              className="track-marker"
              data-past={m.past}
              style={{ left: `${m.share * 100}%` }}
              title={
                m.headline ? `Round ${m.round}: ${m.headline}` : `Announcement at round ${m.round}`
              }
              aria-hidden
            />
          ))}
          {run && <span className="track-head" style={{ left: head }} aria-hidden />}
        </div>
      </div>

      <button
        type="button"
        className="transport-speed"
        aria-label={`Speed ${speed}×. Change speed`}
        data-tip="Speed"
        onClick={() => onSpeed(nextSpeed(speed))}
      >
        {speed}×
      </button>
    </div>
  );
}

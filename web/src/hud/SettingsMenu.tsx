import { useId, useState } from "react";
import { ArrowIcon, ShuffleIcon, SlidersIcon } from "./icons.tsx";
import { MAPS, type MapName } from "./settings.ts";

export type Connection = "pending" | "online" | "offline";

const CONNECTION_TEXT: Record<Connection, string> = {
  pending: "Connecting to the sim server",
  online: "Sim server connected",
  offline: "Sim server offline",
};

/**
 * The settings button and its popover: which map the run walks, the seed, the walkable grid, the
 * developer sandboxes and the server's status. It is a native popover, so a press outside it or
 * Escape closes it, and it sits above everything else on the page.
 */
export default function SettingsMenu({
  map,
  onMap,
  seed,
  onNewSeed,
  grid,
  onGrid,
  connection,
  label,
}: {
  map: MapName;
  onMap: (map: MapName) => void;
  seed: number;
  onNewSeed: () => void;
  grid: boolean;
  onGrid: (grid: boolean) => void;
  connection: Connection;
  /** The run's content label, which the UI must show. */
  label: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="hud-tool"
        popoverTarget={`${id}-menu`}
        data-open={open}
        aria-label="Settings"
        data-tip="Settings"
      >
        <SlidersIcon />
        {connection === "offline" && <span className="hud-badge hud-badge-alert" aria-hidden />}
      </button>

      <div
        id={`${id}-menu`}
        popover="auto"
        className="hud-settings"
        aria-labelledby={`${id}-title`}
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <h2 id={`${id}-title`} className="settings-title">
          Settings
        </h2>

        <section className="settings-group" aria-labelledby={`${id}-world`}>
          <h3 id={`${id}-world`}>World</h3>
          <div className="setting">
            <span>Map</span>
            <div className="segmented" role="group" aria-label="Map">
              {MAPS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={map === m.id}
                  onClick={() => onMap(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <label className="setting">
            <span>Walkable grid</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={grid}
              onChange={(event) => onGrid(event.target.checked)}
            />
          </label>
        </section>

        <section className="settings-group" aria-labelledby={`${id}-run`}>
          <h3 id={`${id}-run`}>Run</h3>
          <div className="setting">
            <span>
              Seed <strong className="setting-value">{seed}</strong>
            </span>
            <button type="button" className="hud-button" onClick={onNewSeed}>
              <ShuffleIcon />
              New seed
            </button>
          </div>
        </section>

        <section className="settings-group" aria-labelledby={`${id}-sandboxes`}>
          <h3 id={`${id}-sandboxes`}>Sandboxes</h3>
          <div className="settings-links">
            <a href="#/town">
              Town map
              <ArrowIcon direction="out" />
            </a>
            <a href="#/shapes">
              Shapes
              <ArrowIcon direction="out" />
            </a>
          </div>
        </section>

        <footer className="settings-foot">
          <p className="server" data-connection={connection}>
            <span className="server-dot" aria-hidden />
            {CONNECTION_TEXT[connection]}
          </p>
          <p>{label} · Fictional people, companies and events</p>
        </footer>
      </div>
    </>
  );
}

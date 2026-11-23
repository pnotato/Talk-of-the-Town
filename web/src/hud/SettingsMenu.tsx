import { type MouseEvent, useId, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowIcon, ShuffleIcon, SlidersIcon } from "./icons.tsx";
import { MAPS, type MapName } from "./settings.ts";
import { applyTheme, currentTheme, revealRadius, THEMES, type ThemeName } from "./theme.ts";

export type Connection = "pending" | "online" | "offline";

const CONNECTION_TEXT: Record<Connection, string> = {
  pending: "Connecting to the sim server",
  online: "Sim server connected",
  offline: "Sim server offline",
};

/**
 * The settings button and its popover: the look, which map the run walks, the seed, the walkable
 * grid, the developer sandboxes and the server's status. It is a native popover, so a press outside it or
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
  const [theme, setTheme] = useState<ThemeName>(currentTheme);

  // The new theme spreads out in a circle from the swatch that chose it, where the browser can.
  function chooseTheme(next: ThemeName, event: MouseEvent<HTMLButtonElement>) {
    const change = () => {
      flushSync(() => setTheme(next));
      applyTheme(next, true);
    };
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      change();
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = revealRadius(x, y, innerWidth, innerHeight);
    document
      .startViewTransition(change)
      .ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          {
            duration: 600,
            easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      // A skipped transition (another one started) has already applied the theme.
      .catch(() => {});
  }

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
        className="hud-settings hud-sheet"
        aria-labelledby={`${id}-title`}
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <h2 id={`${id}-title`} className="settings-title display">
          Settings
        </h2>

        <section className="settings-group" aria-labelledby={`${id}-look`}>
          <h3 id={`${id}-look`}>Look</h3>
          <div className="theme-picker" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="theme-option"
                aria-pressed={theme === t.id}
                onClick={(event) => chooseTheme(t.id, event)}
              >
                {/* Drawn in its own theme: glass, display face, play colour and score colours. */}
                <span className="theme-swatch" data-theme={t.id} aria-hidden>
                  <span className="swatch-type">Aa</span>
                  <span className="swatch-play" />
                  <span className="swatch-lines">
                    <span />
                    <span />
                  </span>
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </section>

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

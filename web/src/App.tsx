import { useSyncExternalStore } from "react";
import { ArrowIcon, BrandMark } from "./hud/icons.tsx";
import CityPage from "./pages/CityPage.tsx";
import ShapesPage from "./pages/ShapesPage.tsx";
import TownPage from "./pages/TownPage.tsx";

// Pages are switched on location.hash; no router dependency. The game comes first and is the
// default for an empty or unknown hash (including the old #/city). The sandboxes are developer
// views, reached from the game's settings.
const pages = [
  { hash: "#/play", label: "Game", Page: CityPage },
  { hash: "#/town", label: "Town map sandbox", Page: TownPage },
  { hash: "#/shapes", label: "Shapes sandbox", Page: ShapesPage },
];

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Over a sandbox: which one it is, and the way back to the game. */
function SandboxBar({ label }: { label: string }) {
  return (
    <nav className="sandbox-bar hud-glass" aria-label="Sandbox">
      <a className="sandbox-back" href="#/play">
        <ArrowIcon direction="back" />
        Back to the game
      </a>
      <span className="sandbox-name">
        <BrandMark />
        {label}
      </span>
      <span className="sandbox-tag">Simulated</span>
    </nav>
  );
}

/**
 * The whole window is the stage: each page draws its scene edge to edge and floats its own
 * controls over it. The game's HUD shows the SIMULATED label; the sandboxes say they are sandboxes.
 */
export default function App() {
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const current = pages.find((p) => p.hash === hash) ?? pages[0];

  return (
    <main className="app" aria-label="Talk of the Town">
      <current.Page />
      {current !== pages[0] && <SandboxBar label={current.label} />}
    </main>
  );
}

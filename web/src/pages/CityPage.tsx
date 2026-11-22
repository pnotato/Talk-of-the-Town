import { useState } from "react";
import CityScene from "../scene/CityScene.tsx";
import { DEFAULT_CROWD_SEED } from "../scene/scatterCrowd.ts";
import "./cityPage.css";

export default function CityPage() {
  const [seed, setSeed] = useState(DEFAULT_CROWD_SEED);
  const [grid, setGrid] = useState(true);

  return (
    <section aria-label="City" style={{ position: "relative", height: "100%" }}>
      <CityScene crowdSeed={seed} showGrid={grid} />
      <div className="city-controls" role="group" aria-label="Placeholder crowd">
        <button type="button" className="city-button" onClick={() => setSeed((s) => s + 1)}>
          Shuffle crowd
        </button>
        <span className="city-seed" aria-live="polite">
          Seed {seed}
        </span>
        <label className="city-toggle">
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
          Grid
        </label>
      </div>
    </section>
  );
}

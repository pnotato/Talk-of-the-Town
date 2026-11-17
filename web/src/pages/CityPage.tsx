import { type CSSProperties, useState } from "react";
import CityScene from "../scene/CityScene.tsx";
import { DEFAULT_CROWD_SEED } from "../scene/scatterCrowd.ts";

// Top right, clear of the app shell's badge and nav at the top left.
const panel: CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "6px 10px",
  borderRadius: 8,
  background: "rgb(255 255 255 / 0.85)",
  boxShadow: "0 1px 2px rgb(0 0 0 / 0.15)",
  font: "14px/1.3 system-ui, sans-serif",
};

const button: CSSProperties = { font: "inherit", padding: "2px 10px", cursor: "pointer" };

export default function CityPage() {
  const [seed, setSeed] = useState(DEFAULT_CROWD_SEED);
  const [grid, setGrid] = useState(true);

  return (
    <section aria-label="City" style={{ position: "relative", height: "100%" }}>
      <CityScene crowdSeed={seed} showGrid={grid} />
      <div role="group" aria-label="Placeholder crowd" style={panel}>
        <button type="button" style={button} onClick={() => setSeed((s) => s + 1)}>
          Shuffle crowd
        </button>
        <span aria-live="polite" style={{ color: "#57606a" }}>
          Seed {seed}
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
          Grid
        </label>
      </div>
    </section>
  );
}

import { useEffect, useMemo } from "react";
import { type BufferGeometry } from "three";
import { box, gable, partsBuilder } from "./harbourGeometry.ts";
import { CHIMNEY, type HarbourHome } from "./layoutHarbour.ts";

// Painted clapboard, like a fishing town's waterfront: each home its own colour, trimmed white.
const HOME_BODIES = [
  "#c75e50", // red
  "#e0aa4c", // mustard
  "#4f9c96", // teal
  "#43648c", // navy
  "#93b78c", // sage
  "#82b0d1", // sky
  "#9a7299", // plum
  "#e58e6e", // coral
  "#efe3c7", // cream
  "#5e8d68", // spruce
];
const ROOFS = ["#4f5661", "#6b7783", "#8a5244", "#46655a"];
const DOORS = ["#2f4a6b", "#b8443a", "#2f6b5a", "#e1b04b", "#4a3f63"];
const TRIM = "#f6f1e7";
const PANE = "#3f4f60";
const STONE = "#a8a090";
const BRICK = "#8d5a4a";

const FOUNDATION = 0.3;
const STOREY = 1.3;
const WINDOW = { width: 0.52, height: 0.7 };
const EAVES = 0.18; // the roof's overhang past the walls

// One window on a wall facing local +z: a white frame round a dark pane.
function windowParts(x: number, y: number, z: number): BufferGeometry[] {
  return [
    box(WINDOW.width + 0.2, WINDOW.height + 0.2, 0.05, x, y, z, TRIM),
    box(WINDOW.width, WINDOW.height, 0.08, x, y, z + 0.01, PANE),
  ];
}

// A home in its own space, its front (and door) facing local +z, standing on y = 0.
function homeParts(h: HarbourHome): BufferGeometry[] {
  const w = h.width;
  const d = h.depth;
  const wall = h.wallHeight;
  const body = HOME_BODIES[h.body % HOME_BODIES.length];
  const roof = ROOFS[h.roofColour % ROOFS.length];
  const storeys = Math.max(1, Math.round((wall - 0.25) / STOREY));
  const parts: BufferGeometry[] = [
    box(w + 0.12, FOUNDATION, d + 0.12, 0, FOUNDATION / 2, 0, STONE),
    box(w, wall - FOUNDATION, d, 0, (wall + FOUNDATION) / 2, 0, body),
  ];
  // Corner boards.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        box(
          0.14,
          wall - FOUNDATION,
          0.14,
          (sx * w) / 2,
          (wall + FOUNDATION) / 2,
          (sz * d) / 2,
          TRIM,
        ),
      );
    }
  }
  // The roof: a gable over the front ("side", ridge along the front) or facing it ("front").
  const span = h.roof === "side" ? d : w;
  const run = h.roof === "side" ? w : d;
  const lift = (EAVES * 2 * h.roofHeight) / span; // keeps the pitch with the eaves overhanging
  const roofGeometry = gable(
    run + 0.1,
    span + 2 * EAVES,
    h.roofHeight + lift,
    roof,
    body,
  ).translate(0, wall - lift, 0);
  if (h.roof === "front") roofGeometry.rotateY(Math.PI / 2);
  parts.push(roofGeometry);
  // A trim board under the eaves, all round.
  parts.push(box(w + 0.16, 0.14, d + 0.16, 0, wall - 0.07, 0, TRIM));
  // The chimney, off to one side of the ridge.
  const chimneyX = h.roof === "side" ? w * 0.28 : 0;
  const chimneyZ = h.roof === "side" ? 0 : -d * 0.25;
  const chimneyHeight = h.roofHeight * 0.6 + CHIMNEY;
  parts.push(
    box(
      0.42,
      chimneyHeight,
      0.42,
      chimneyX,
      wall + h.roofHeight + CHIMNEY - chimneyHeight / 2,
      chimneyZ,
      BRICK,
    ),
  );
  // The door with its frame, off centre on the ground floor, and a window beside it.
  const front = d / 2 + 0.03;
  const doorX = -w * 0.18;
  parts.push(
    box(0.95, 1.5, 0.05, doorX, FOUNDATION + 0.75, front, TRIM),
    box(0.72, 1.32, 0.08, doorX, FOUNDATION + 0.66, front + 0.01, DOORS[h.door % DOORS.length]),
    ...windowParts(w * 0.24, FOUNDATION + 0.85, front),
  );
  // Upper storeys: two windows across the front; one each side and at the back on every storey.
  for (let s = 0; s < storeys; s++) {
    const y = FOUNDATION + 0.85 + s * STOREY;
    if (s > 0) {
      parts.push(...windowParts(-w * 0.22, y, front), ...windowParts(w * 0.22, y, front));
    }
    for (const side of [-1, 1]) {
      const wing = windowParts(0, y, 0).map((g) =>
        g.rotateY((side * Math.PI) / 2).translate(side * (w / 2 + 0.03), 0, 0),
      );
      parts.push(...wing);
    }
    parts.push(...windowParts(0, y, 0).map((g) => g.rotateY(Math.PI).translate(0, 0, -front)));
  }
  // The gable end over the street gets a small attic window.
  if (h.roof === "front") parts.push(...windowParts(0, wall + h.roofHeight * 0.38, front - 0.02));
  return parts;
}

/** The town's clapboard homes: one merged mesh, each home placed and turned to face its street. */
export function HarbourVillage({ homes }: { homes: HarbourHome[] }) {
  const geometry = useMemo(() => {
    const parts = partsBuilder();
    for (const h of homes) parts.add(homeParts(h), h.x, 0, h.z, h.rotationY);
    return parts.merge();
  }, [homes]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshLambertMaterial vertexColors />
    </mesh>
  );
}

import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type BufferGeometry, type Group } from "three";
import { useReducedMotion } from "./blobMedia.ts";
import { CityScreen } from "./CityScreens.tsx";
import { box, cylinder, partsBuilder } from "./harbourGeometry.ts";
import { waveHeight } from "./harbourMotion.ts";
import { type HarbourLayout, WATER_LEVEL } from "./layoutHarbour.ts";
import { newsPlaceholder, SCREEN_LOOKS } from "./screenPlaceholders.ts";

const HULL = "#4c5866";
const STRIPE = "#f2c14e";
const DECK = "#9aa2a8";
const STEEL = "#2b2f36";
const BULB = "#fff1c9";
const BEZEL = 0.35;
const HOUSING = 0.45;

function bargeGeometry(harbour: HarbourLayout): BufferGeometry {
  const { barge, panel, deck } = harbour.screen;
  const parts = partsBuilder();
  const w = barge.width;
  const d = barge.depth;
  const top = panel.y + panel.height / 2;
  const postX = panel.width / 2 + BEZEL + 0.2;
  parts.add([
    box(w, 1.4, d, 0, deck - 0.7, 0, HULL),
    box(w + 0.04, 0.22, d + 0.04, 0, deck - 0.32, 0, STRIPE),
    box(w - 0.3, 0.06, d - 0.3, 0, deck + 0.03, 0, DECK),
    // Two steel posts and a dark case behind the panel, its bezel and a beam over the top.
    box(0.45, top - deck + 0.3, 0.45, -postX, (top + deck + 0.3) / 2, -0.35, STEEL),
    box(0.45, top - deck + 0.3, 0.45, postX, (top + deck + 0.3) / 2, -0.35, STEEL),
    box(panel.width + 2 * BEZEL, panel.height + 2 * BEZEL, 0.25, 0, panel.y, -0.13, STEEL),
    box(panel.width, panel.height, HOUSING, 0, panel.y, -0.25 - HOUSING / 2, "#4d535b"),
    box(2 * postX + 0.45, 0.3, 0.6, 0, top + 0.3, -0.35, STEEL),
    // Bollards and a rail round the deck.
    ...[-1, 1].flatMap((s) => [
      cylinder(0.18, 0.2, 0.45, 8, s * (w / 2 - 0.6), deck + 0.25, d / 2 - 0.5, STEEL),
      cylinder(0.18, 0.2, 0.45, 8, s * (w / 2 - 0.6), deck + 0.25, -d / 2 + 0.5, STEEL),
    ]),
  ]);
  // A string of bulbs along the beam over the screen.
  for (let k = 0; k <= 16; k++) {
    parts.add([box(0.16, 0.16, 0.16, -postX + (2 * postX * k) / 16, top + 0.52, -0.1, BULB)]);
  }
  return parts.merge();
}

// The barge hides the water under it from the pointer.
const stop = (event: ThreeEvent<MouseEvent>) => event.stopPropagation();

/**
 * The news screen on a barge moored in the bay, facing the boardwalk and the pier, riding the swell
 * a little. It shows the fictional news placeholder until a live report plugs in.
 */
export function HarbourScreen({ harbour }: { harbour: HarbourLayout }) {
  const still = useReducedMotion();
  const { barge, panel } = harbour.screen;
  const geometry = useMemo(() => bargeGeometry(harbour), [harbour]);
  // Real content plugs in here: swap the placeholder for a texture drawn from the story.
  const news = useMemo(() => newsPlaceholder(panel.width / panel.height, SCREEN_LOOKS[0]), [panel]);
  useEffect(() => () => [geometry, news].forEach((r) => r.dispose()), [geometry, news]);
  const group = useRef<Group>(null);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g || still) return;
    const t = clock.elapsedTime;
    // A heavy barge: a third of the swell, and a slow roll.
    g.position.y = WATER_LEVEL + waveHeight(barge.x, barge.z, t) * 0.35;
    g.rotation.z =
      (waveHeight(barge.x + 3, barge.z, t) - waveHeight(barge.x - 3, barge.z, t)) * 0.05;
  });

  return (
    <group
      ref={group}
      position={[barge.x, WATER_LEVEL, barge.z]}
      rotation-y={barge.rotationY}
      onClick={stop}
    >
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <CityScreen
        panel={{ x: 0, z: 0, y: panel.y, width: panel.width, height: panel.height, rotationY: 0 }}
        content={news}
        base={0}
      />
    </group>
  );
}

import { type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type BufferGeometry, CylinderGeometry, InstancedMesh, Matrix4, Vector3 } from "three";
import { box, cylinder, partsBuilder } from "./harbourGeometry.ts";
import {
  boardwalkLamps,
  DECK_OVERHANG,
  DECK_THICKNESS,
  type HarbourLayout,
  type HarbourRect,
  LAMP_HEIGHT,
  pierLamps,
  WATER_LEVEL,
} from "./layoutHarbour.ts";
import { seededRandom } from "./mapLayout.ts";

// Sun-bleached timber in a few tones, so the boards read as boards. Pale, so every mood colour
// stands out on it, as on the city's paving.
const PLANKS = ["#ddcdb2", "#d5c4a7", "#e3d5bc", "#d0bfa1", "#dacaad"];
const JOISTS = "#8f765b";
const RAIL = "#f3eee4";
const PILE = "#6c5442";
const IRON = "#2f3b36";
const LANTERN = "#fff0c8";

const PLANK = 0.46; // a board's width
const GAP = 0.06; // between boards
const BOARD = 0.03; // a board's thickness, its top at 0.03
const POST_EVERY = 1.9;
const RAIL_HEIGHT = 1.05;
const PILE_EVERY = 3.2;

interface Deck extends HarbourRect {
  /** Which way the boards run: across the way people walk. */
  boards: "x" | "z";
}

/** The decks as drawn: each walkable area plus its overhang where it stands over the water. */
function harbourDecks(harbour: HarbourLayout): Deck[] {
  const { boardwalk, pier, pierhead, wheel } = harbour;
  const o = DECK_OVERHANG;
  const pierNorth = pier.z - pier.depth / 2;
  return [
    // The boardwalk reaches out over the sea wall.
    {
      x: boardwalk.x,
      z: boardwalk.z - o / 2,
      width: boardwalk.width + 0.6,
      depth: boardwalk.depth + o,
      boards: "x",
    },
    {
      x: pier.x,
      z: (pierNorth - o) / 2,
      width: pier.width + 2 * o,
      depth: -pierNorth - o,
      boards: "z",
    },
    {
      ...pierhead,
      width: pierhead.width + 2 * o,
      depth: pierhead.depth + o,
      z: pierhead.z - o / 2,
      boards: "z",
    },
    { ...wheel.platform, boards: "z" },
  ];
}

// Boards, each its own tone, laid across a dark bed of joists that shows in the gaps.
function boards(deck: Deck, random: () => number): BufferGeometry[] {
  // The bed's top sits just above the grass, so the gaps over land don't flicker.
  const pieces: BufferGeometry[] = [
    box(deck.width, DECK_THICKNESS, deck.depth, deck.x, 0.006 - DECK_THICKNESS / 2, deck.z, JOISTS),
  ];
  const along = deck.boards === "x" ? deck.width : deck.depth; // the boards are laid along this
  const count = Math.floor(along / (PLANK + GAP));
  const pitch = along / count;
  for (let k = 0; k < count; k++) {
    const tone = PLANKS[Math.floor(random() * PLANKS.length)];
    const offset = -along / 2 + pitch * (k + 0.5);
    pieces.push(
      deck.boards === "x"
        ? box(pitch - GAP, BOARD, deck.depth, deck.x + offset, BOARD / 2, deck.z, tone)
        : box(deck.width, BOARD, pitch - GAP, deck.x, BOARD / 2, deck.z + offset, tone),
    );
  }
  return pieces;
}

// A white railing from a to b: posts, a top rail and a middle rail.
function railing(ax: number, az: number, bx: number, bz: number): BufferGeometry[] {
  const length = Math.hypot(bx - ax, bz - az);
  const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
  const pieces: BufferGeometry[] = [];
  const posts = Math.max(1, Math.round(length / POST_EVERY));
  for (let k = 0; k <= posts; k++) {
    const t = k / posts;
    pieces.push(
      box(0.12, RAIL_HEIGHT, 0.12, ax + (bx - ax) * t, RAIL_HEIGHT / 2, az + (bz - az) * t, RAIL),
    );
  }
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  for (const [y, h] of [
    [RAIL_HEIGHT, 0.1],
    [RAIL_HEIGHT * 0.55, 0.06],
  ]) {
    pieces.push(
      alongX ? box(length, h, 0.1, mx, y, mz, RAIL) : box(0.1, h, length, mx, y, mz, RAIL),
    );
  }
  return pieces;
}

function railings(harbour: HarbourLayout): BufferGeometry[] {
  const { boardwalk, pier, pierhead, wheel } = harbour;
  const o = DECK_OVERHANG - 0.12;
  const pieces: BufferGeometry[] = [];
  const west = boardwalk.x - boardwalk.width / 2 - 0.2;
  const east = boardwalk.x + boardwalk.width / 2 + 0.2;
  const mouth = pier.width / 2 + DECK_OVERHANG;
  const sea = boardwalk.z - boardwalk.depth / 2 - o;
  pieces.push(...railing(west, sea, -mouth, sea), ...railing(mouth, sea, east, sea));
  // Down both sides of the pier.
  const pierNorth = pier.z - pier.depth / 2;
  for (const s of [-1, 1]) {
    const x = s * (pier.width / 2 + o);
    pieces.push(...railing(x, sea, x, pierNorth));
  }
  // Round the pier head, open to the pier and to the ferris wheel's platform.
  const ph = {
    west: pierhead.x - pierhead.width / 2 - o,
    east: pierhead.x + pierhead.width / 2 + o,
    south: pierhead.z + pierhead.depth / 2,
    north: pierhead.z - pierhead.depth / 2 - o,
  };
  const gate = wheel.platform.width / 2;
  pieces.push(
    ...railing(ph.west, ph.south, -mouth, ph.south),
    ...railing(mouth, ph.south, ph.east, ph.south),
    ...railing(ph.west, ph.south, ph.west, ph.north),
    ...railing(ph.east, ph.south, ph.east, ph.north),
    ...railing(ph.west, ph.north, -gate, ph.north),
    ...railing(gate, ph.north, ph.east, ph.north),
  );
  return pieces;
}

// Lamp posts on the railings: an iron post and a lantern, the festoons strung between them.
function lamps(): BufferGeometry[] {
  const pieces: BufferGeometry[] = [];
  for (const p of [...boardwalkLamps(), ...pierLamps()]) {
    pieces.push(
      cylinder(0.08, 0.1, LAMP_HEIGHT - 0.35, 8, p.x, (LAMP_HEIGHT - 0.35) / 2, p.z, IRON),
      box(0.32, 0.4, 0.32, p.x, LAMP_HEIGHT - 0.18, p.z, LANTERN),
      cylinder(0.05, 0.26, 0.2, 4, p.x, LAMP_HEIGHT + 0.08, p.z, IRON),
    );
  }
  return pieces;
}

// Piles: down the edges of everything over the water, and a grid under the pier head.
function piles(harbour: HarbourLayout): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const decks = harbourDecks(harbour).slice(1); // the boardwalk stands on the sea wall
  for (const d of decks) {
    const nx = Math.max(1, Math.round(d.width / PILE_EVERY));
    const nz = Math.max(1, Math.round(d.depth / PILE_EVERY));
    for (let i = 0; i <= nx; i++) {
      for (let k = 0; k <= nz; k++) {
        const edge = i === 0 || i === nx || k === 0 || k === nz;
        if (!edge && (i + k) % 2 === 1) continue;
        out.push({
          x: d.x - d.width / 2 + 0.25 + ((d.width - 0.5) * i) / nx,
          z: d.z - d.depth / 2 + 0.25 + ((d.depth - 0.5) * k) / nz,
        });
      }
    }
  }
  // Under the boardwalk's lip.
  const { boardwalk } = harbour;
  for (let x = -boardwalk.width / 2; x <= boardwalk.width / 2; x += PILE_EVERY * 1.5) {
    out.push({ x, z: -DECK_OVERHANG + 0.25 });
  }
  return out;
}

function Piles({ harbour }: { harbour: HarbourLayout }) {
  const spots = useMemo(() => piles(harbour), [harbour]);
  const height = DECK_THICKNESS - WATER_LEVEL + 2;
  const geometry = useMemo(
    () =>
      new CylinderGeometry(0.2, 0.22, height, 7).translate(
        0,
        -DECK_THICKNESS - height / 2 + 0.05,
        0,
      ),
    [height],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new Matrix4();
    const at = new Vector3();
    spots.forEach((p, i) => m.setMatrixAt(i, matrix.makeTranslation(at.set(p.x, 0, p.z))));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [spots]);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, spots.length]} castShadow receiveShadow>
      <meshLambertMaterial color={PILE} />
    </instancedMesh>
  );
}

// The decks hide the water under them from the pointer.
const stop = (event: ThreeEvent<MouseEvent>) => event.stopPropagation();

/**
 * The timber decks blobs walk on over the water's edge: the boardwalk along the sea wall, the pier,
 * the pier head and the ferris wheel's platform, with white railings, lamp posts and the piles
 * they stand on.
 */
export function HarbourDecks({ harbour }: { harbour: HarbourLayout }) {
  const geometry = useMemo(() => {
    const random = seededRandom(0xdec4);
    const parts = partsBuilder();
    for (const deck of harbourDecks(harbour)) parts.add(boards(deck, random));
    parts.add(railings(harbour));
    parts.add(lamps());
    return parts.merge();
  }, [harbour]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group onClick={stop}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <Piles harbour={harbour} />
    </group>
  );
}

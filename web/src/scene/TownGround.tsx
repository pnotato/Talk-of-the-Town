import { useEffect, useMemo } from "react";
import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import {
  MAIN_STREET,
  SIDEWALK,
  type TownBlockKind,
  type TownLayout,
  type TownRect,
} from "./layoutTown.ts";

// Far past where the fog turns solid even on a very narrow screen, so the world never ends.
export const GROUND_RADIUS = 5000;
export const GRASS = "#a3b292";

/** Top of the town's ground layers: the grid is laid here and blobs stand on it. */
export const TOWN_SURFACE = 0.05;

const ASPHALT = "#9b9a96";
const KERB = "#d9d1c0"; // sidewalks
const PAVING = "#e6dcc6"; // the square
const TRIM = "#d2c4a4"; // a border of darker setts round the square
const CARPET = "#ebe2cd"; // lighter flags laid in the middle of the square
const LAWN = "#b3c39d";
const WALK = "#e4dac4";
const LINE = "#e2cc78"; // Main Street's centre line
const ZEBRA = "#ecebe4";

const GROUND: Record<TownBlockKind, string> = {
  square: PAVING,
  townHall: LAWN,
  homes: LAWN,
  park: "#abc192",
  shops: "#cdc6b6", // the yards behind the shops
};

const DASH = { length: 1.6, gap: 1.6, width: 0.16 };
const DASH_CLEAR = 2.8; // the line stops this far short of a junction, clear of its crossings
const STRIPE = { width: 0.45, gap: 0.45, length: 1.6 };
const TRIM_WIDTH = 0.6;
// The square's middle: in from its sides past the rows of trees, and from the flower beds to
// near its south edge.
const CARPET_INSET = { side: 4.2, north: 5, south: 2.4 };

interface Patch extends TownRect {
  color: string;
}

// Flat rectangles facing up at height y, coloured per vertex, as one geometry.
function patches(rects: Patch[], y: number): BufferGeometry {
  const positions = new Float32Array(rects.length * 18);
  const colors = new Float32Array(rects.length * 18);
  const normals = new Float32Array(rects.length * 18);
  const c = new Color();
  rects.forEach(({ x, z, width, depth, color }, i) => {
    const [x0, x1, z0, z1] = [x - width / 2, x + width / 2, z - depth / 2, z + depth / 2];
    positions.set([x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0], i * 18);
    c.set(color);
    for (let v = 0; v < 6; v++) {
      colors.set([c.r, c.g, c.b], i * 18 + v * 3);
      normals.set([0, 1, 0], i * 18 + v * 3);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

// Dashes down the middle of Main Street, between junctions and on out of town.
function centreLine(town: TownLayout): Patch[] {
  const dashes: Patch[] = [];
  const pitch = DASH.length + DASH.gap;
  for (const s of town.streets) {
    // Junctions are no wider than a side street; the line breaks across them.
    if (!s.main || s.width <= MAIN_STREET) continue;
    const count = Math.floor((s.width - 2 * DASH_CLEAR + DASH.gap) / pitch);
    const from = s.x - (count * pitch - DASH.gap) / 2;
    for (let d = 0; d < count; d++) {
      const x = from + d * pitch + DASH.length / 2;
      dashes.push({ x, z: s.z, width: DASH.length, depth: DASH.width, color: LINE });
    }
  }
  return dashes;
}

// Zebra crossings over the four streets round the square, near each of its corners.
function crossings(town: TownLayout): Patch[] {
  const { square } = town;
  const half = { x: square.width / 2, z: square.depth / 2 };
  const inFromCorner = STRIPE.length / 2 + 0.6;
  const pitch = STRIPE.width + STRIPE.gap;
  const stripes: Patch[] = [];
  for (const s of town.streets) {
    // A north-south street beside the square is crossed east-west, and the other way round.
    const northSouth = s.depth > s.width;
    const beside = northSouth
      ? Math.abs(s.z - square.z) < 1e-6 &&
        Math.abs(Math.abs(s.x - square.x) - half.x - s.width / 2) < 1e-6
      : Math.abs(s.x - square.x) < 1e-6 &&
        Math.abs(Math.abs(s.z - square.z) - half.z - s.depth / 2) < 1e-6;
    if (!beside) continue;
    const count = Math.floor(((northSouth ? s.width : s.depth) - 0.6) / pitch);
    for (const end of [-1, 1]) {
      for (let k = 0; k < count; k++) {
        const offset = (k - (count - 1) / 2) * pitch;
        stripes.push(
          northSouth
            ? {
                x: s.x + offset,
                z: square.z + end * (half.z - inFromCorner),
                width: STRIPE.width,
                depth: STRIPE.length,
                color: ZEBRA,
              }
            : {
                x: square.x + end * (half.x - inFromCorner),
                z: s.z + offset,
                width: STRIPE.length,
                depth: STRIPE.width,
                color: ZEBRA,
              },
        );
      }
    }
  }
  return stripes;
}

// Three layers, each drawn just above the one before by height and polygonOffset, so nothing
// flickers: the streets and the blocks to their kerbs; the ground inside each sidewalk, road
// markings and the square's border; and the front walks and the town hall's path.
function buildLayers(town: TownLayout): BufferGeometry[] {
  const { square } = town;
  const base: Patch[] = [
    ...town.streets.map((s) => ({ ...s, color: ASPHALT })),
    ...town.blocks.map((b) => ({ ...b, color: b.kind === "square" ? PAVING : KERB })),
  ];
  const inner: Patch[] = town.blocks
    .filter((b) => b.kind !== "square")
    .map((b) => ({
      x: b.x,
      z: b.z,
      width: b.width - 2 * SIDEWALK,
      depth: b.depth - 2 * SIDEWALK,
      color: GROUND[b.kind],
    }));
  const edgeZ = square.depth / 2 - TRIM_WIDTH / 2;
  const edgeX = square.width / 2 - TRIM_WIDTH / 2;
  const trim: Patch[] = [
    { ...square, z: square.z - edgeZ, depth: TRIM_WIDTH, color: TRIM },
    { ...square, z: square.z + edgeZ, depth: TRIM_WIDTH, color: TRIM },
    { ...square, x: square.x - edgeX, width: TRIM_WIDTH, color: TRIM },
    { ...square, x: square.x + edgeX, width: TRIM_WIDTH, color: TRIM },
  ];
  const north = square.z - square.depth / 2 + CARPET_INSET.north;
  const south = square.z + square.depth / 2 - CARPET_INSET.south;
  const carpet = {
    x: square.x,
    z: (north + south) / 2,
    width: square.width - 2 * CARPET_INSET.side,
    depth: south - north,
  };
  const carpetEdges: Patch[] = [
    { ...carpet, color: TRIM },
    { ...carpet, width: carpet.width - 0.6, depth: carpet.depth - 0.6, color: CARPET },
  ];
  const paths: Patch[] = town.walks.map((w) => ({ ...w, color: WALK }));
  const hall = town.buildings.find((b) => b.kind === "townHall");
  const hallBlock = town.blocks.find((b) => b.kind === "townHall");
  if (hall && hallBlock) {
    const front = hall.z + hall.depth / 2;
    const kerb = hallBlock.z + hallBlock.depth / 2 - SIDEWALK;
    paths.push({ x: hall.x, z: (front + kerb) / 2, width: 5, depth: kerb - front, color: WALK });
  }
  return [
    patches(base, 0.01),
    patches([...inner, ...trim, ...centreLine(town), ...crossings(town)], 0.02),
    patches([...paths, carpetEdges[0]], 0.03),
    patches([carpetEdges[1]], 0.04),
  ];
}

/** Open fields, and the town on them: streets, sidewalks, lawns, yards and the square's paving. */
export function TownGround({ town }: { town: TownLayout }) {
  const layers = useMemo(() => buildLayers(town), [town]);
  useEffect(() => () => layers.forEach((g) => g.dispose()), [layers]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[GROUND_RADIUS, 96]} />
        <meshLambertMaterial color={GRASS} />
      </mesh>
      {layers.map((geometry, i) => (
        <mesh key={i} geometry={geometry} receiveShadow>
          <meshLambertMaterial
            vertexColors
            polygonOffset
            polygonOffsetFactor={-1 - i}
            polygonOffsetUnits={-1 - i}
          />
        </mesh>
      ))}
    </group>
  );
}

import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Placement, useInstances } from "./cityInstances.ts";
import { CityScreen } from "./CityScreens.tsx";
import {
  LAMP_HEIGHT,
  SCREEN_BEZEL,
  TREE_RADIUS,
  type TownLayout,
  type TownProp,
  type TownScreen,
} from "./layoutTown.ts";
import { seededRandom } from "./mapLayout.ts";
import { newsPlaceholder, SCREEN_LOOKS } from "./screenPlaceholders.ts";

const FRAME = "#2b2f36";
const STEEL = "#4d535b";
const STONE = "#c9c1b0";
const WOOD = "#8a6a50";
const IRON = "#2f3b36";
const LANTERN = "#f3e6c4";
const BED_SOIL = "#7d9a5e";
const FLOWERS = ["#d77a6f", "#e2bf5c", "#a483b8", "#f0e6da", "#e39a6a"];

const HOUSING = 0.4; // depth of the screen's case behind its bezel

function paint(geometry: BufferGeometry, hex: string): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new Color(hex);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "color") g.deleteAttribute(name);
  }
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) =>
  paint(new BoxGeometry(w, h, d).translate(x, y, z), hex);

// The screen's frame: a stone plinth, two steel posts, a dark case and bezel round the panel
// and a beam across the top. In the screen's own space, the panel facing +z.
function frameParts({ panel, footprint, top }: TownScreen): BufferGeometry[] {
  const back = panel.z - footprint.z; // the panel's plane, from the footprint's middle
  const bezelW = panel.width + 2 * SCREEN_BEZEL;
  const bezelH = panel.height + 2 * SCREEN_BEZEL;
  const postX = footprint.width / 2 - 0.25;
  return [
    box(footprint.width, 0.35, footprint.depth, 0, 0.175, 0, STONE),
    box(0.5, top, 0.5, -postX, top / 2, back - 0.25, STEEL),
    box(0.5, top, 0.5, postX, top / 2, back - 0.25, STEEL),
    box(bezelW, bezelH, 0.25, 0, panel.y, back - 0.13, FRAME),
    box(panel.width, panel.height, HOUSING, 0, panel.y, back - 0.25 - HOUSING / 2, STEEL),
    box(footprint.width, 0.3, 0.7, 0, top - 0.15, back - 0.25, FRAME),
  ];
}

// Benches (a slatted seat and back on two legs), lamp posts and flower beds, each in its own
// space, placed and merged.
function propParts(prop: TownProp, i: number): BufferGeometry[] {
  if (prop.kind === "bench") {
    const w = prop.width;
    return [
      box(w, 0.1, 0.45, 0, 0.45, 0.05, WOOD),
      box(w, 0.4, 0.08, 0, 0.75, -0.2, WOOD),
      box(0.1, 0.45, 0.5, -w / 2 + 0.2, 0.225, 0, IRON),
      box(0.1, 0.45, 0.5, w / 2 - 0.2, 0.225, 0, IRON),
    ];
  }
  if (prop.kind === "lamp") {
    return [
      paint(new CylinderGeometry(0.17, 0.2, 0.3, 8).translate(0, 0.15, 0), IRON),
      paint(
        new CylinderGeometry(0.06, 0.07, LAMP_HEIGHT - 0.6, 8).translate(
          0,
          LAMP_HEIGHT / 2 - 0.15,
          0,
        ),
        IRON,
      ),
      box(0.3, 0.38, 0.3, 0, LAMP_HEIGHT - 0.35, 0, LANTERN),
      paint(
        new CylinderGeometry(0.05, 0.24, 0.18, 4)
          .rotateY(Math.PI / 4)
          .translate(0, LAMP_HEIGHT - 0.07, 0),
        IRON,
      ),
    ];
  }
  // A flower bed: a stone kerb round a green top dotted with flowers.
  const { width: w, depth: d } = prop;
  const parts = [
    box(w, 0.4, d, 0, 0.2, 0, STONE),
    box(w - 0.3, 0.06, d - 0.3, 0, 0.41, 0, BED_SOIL),
  ];
  const random = seededRandom(i + 1);
  const count = Math.round(w * d * 1.4);
  for (let k = 0; k < count; k++) {
    const x = (random() - 0.5) * (w - 0.6);
    const z = (random() - 0.5) * (d - 0.6);
    const color = FLOWERS[Math.floor(random() * FLOWERS.length)];
    parts.push(paint(new SphereGeometry(0.17 + random() * 0.08, 6, 4).translate(x, 0.5, z), color));
  }
  return parts;
}

function buildFurniture(town: TownLayout): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const place = (x: number, z: number, rotationY: number, pieces: BufferGeometry[]) => {
    matrix.compose(new Vector3(x, 0, z), turn.setFromAxisAngle(up, rotationY), one);
    for (const piece of pieces) parts.push(piece.applyMatrix4(matrix));
  };
  const { footprint } = town.screen;
  place(footprint.x, footprint.z, footprint.rotationY, frameParts(town.screen));
  town.props.forEach((p, i) => place(p.x, p.z, p.rotationY, propParts(p, i)));
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * The square's news screen on its frame, and its benches, lamps, flower beds and the stone
 * rings round its trees (TownTrees draws the trees). The screen shows the fictional news
 * placeholder until a live report plugs in.
 */
export function TownSquare({ town }: { town: TownLayout }) {
  const furniture = useMemo(() => buildFurniture(town), [town]);
  useEffect(() => () => furniture.dispose(), [furniture]);

  // Real content plugs in here: swap the placeholder for a texture drawn from the story.
  const { panel } = town.screen;
  const news = useMemo(
    () => newsPlaceholder(panel.width / panel.height, SCREEN_LOOKS[0]),
    [panel.width, panel.height],
  );
  useEffect(() => () => news.dispose(), [news]);

  const { square } = town;
  const rings = useMemo((): Placement[] => {
    return town.trees
      .filter(
        (t) =>
          Math.abs(t.x - square.x) < square.width / 2 &&
          Math.abs(t.z - square.z) < square.depth / 2,
      )
      .map((t) => ({ x: t.x, y: 0.12, z: t.z, rotationY: 0, sx: t.size, sy: 1, sz: t.size }));
  }, [town.trees, square]);
  const ringMesh = useInstances(rings);
  // A low stone ring round each trunk, inside the canopy.
  const ringGeometry = useMemo(
    () => new CylinderGeometry(TREE_RADIUS * 0.6, TREE_RADIUS * 0.65, 0.24, 16),
    [],
  );
  useEffect(() => () => ringGeometry.dispose(), [ringGeometry]);

  return (
    <group>
      <mesh geometry={furniture} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <CityScreen panel={panel} content={news} base={0} />
      <instancedMesh ref={ringMesh} args={[ringGeometry, undefined, rings.length]} receiveShadow>
        <meshLambertMaterial color={STONE} />
      </instancedMesh>
    </group>
  );
}

import { type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Shape,
  Vector3,
} from "three";
import { box, paint, partsBuilder } from "./harbourGeometry.ts";
import { type HarbourLayout, type HarbourRect, onLand, WATER_LEVEL } from "./layoutHarbour.ts";
import { GROUND_RADIUS } from "./TownGround.tsx";

export const LAND_GRASS = "#a9ba8b";
const SHORE_STONE = "#b9ab96";
const GRAVEL = "#ddd1b7";
const PATH = "#e6dcc6";
const PEBBLES = "#d6cbb2"; // the strip of shingle between the grass and the water
const MOWN = ["#bdd09b", "#b1c58f"];
const CONCRETE = "#cdc4b2";
const ISLAND_ROCK = "#b3a59b";
const ROCKS = ["#b8a9a1", "#a99b93", "#c5b7ac", "#9e928b", "#bba591"];
// How deep the land runs below the grass, so its shore shows as a stone face above the water.
const LAND_DEPTH = 4;
const STRIPE = 2.5; // the green's mown stripes
const SHINGLE = 3.2; // how far the shingle runs inland from the water
const SHINGLE_REACH = 150; // along the shore either side of the sea wall, out of the fog

/** The land: everything south of the coast, a lawn on top and a stone face down to the water. */
function buildLand(harbour: HarbourLayout): BufferGeometry {
  // Shape space is (x, -z), so after turning it flat the shape's +y runs north.
  const shape = new Shape();
  harbour.coast.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)));
  shape.lineTo(GROUND_RADIUS, -GROUND_RADIUS);
  shape.lineTo(-GROUND_RADIUS, -GROUND_RADIUS);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth: LAND_DEPTH, bevelEnabled: false })
    .rotateX(-Math.PI / 2)
    .translate(0, -LAND_DEPTH, 0);
}

const flat = (r: HarbourRect, y: number, hex: string) =>
  paint(new PlaneGeometry(r.width, r.depth).rotateX(-Math.PI / 2).translate(r.x, y, r.z), hex);

// A strip of shingle along the natural shore, either side of the sea wall: a band inland from
// the waterline, facing up.
function shingle(harbour: HarbourLayout): BufferGeometry {
  const { coast } = harbour;
  const positions: number[] = [];
  const inland = (i: number) => {
    const a = coast[Math.max(0, i - 1)];
    const b = coast[Math.min(coast.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // The water lies to the shore's left walking east, so inland is to its right.
    return { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
  };
  const y = 0.011;
  for (let i = 1; i < coast.length; i++) {
    const a = coast[i - 1];
    const b = coast[i];
    if (Math.abs(a.x) > SHINGLE_REACH || Math.abs(b.x) > SHINGLE_REACH) continue;
    if (a.z === 0 && b.z === 0) continue; // the sea wall
    const na = inland(i - 1);
    const nb = inland(i);
    const a2 = [a.x + na.x * SHINGLE, y, a.z + na.z * SHINGLE];
    const b2 = [b.x + nb.x * SHINGLE, y, b.z + nb.z * SHINGLE];
    // Wound to face up.
    positions.push(a.x, y, a.z, ...b2, b.x, y, b.z, a.x, y, a.z, ...a2, ...b2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return paint(geometry, PEBBLES);
}

// Lanes, front paths and the green's mown stripes, a hair above the grass.
function buildPatches(harbour: HarbourLayout): BufferGeometry {
  const parts = partsBuilder();
  parts.add([shingle(harbour)]);
  const { green } = harbour;
  const count = Math.round(green.depth / STRIPE);
  for (let k = 0; k < count; k++) {
    const depth = green.depth / count;
    const z = green.z - green.depth / 2 + depth * (k + 0.5);
    parts.add([flat({ x: green.x, z, width: green.width, depth }, 0.012, MOWN[k % 2])]);
  }
  for (const lane of harbour.lanes) parts.add([flat(lane, 0.014, GRAVEL)]);
  // A path from each Front Street and Hill Street door to the lane.
  for (const h of harbour.homes) {
    if (h.neighbourhood > 2) continue;
    const front = h.z - h.depth / 2;
    const lane = harbour.lanes.find((l) => Math.abs(l.x - h.x) < l.width / 2 && l.z < front);
    if (!lane) continue;
    const edge = lane.z + lane.depth / 2;
    parts.add([
      flat({ x: h.x, z: (edge + front) / 2, width: 0.9, depth: front - edge }, 0.016, PATH),
    ]);
  }
  return parts.merge();
}

// The lighthouse's rock and the breakwater's concrete walk.
function buildIsland(harbour: HarbourLayout): BufferGeometry {
  const parts = partsBuilder();
  const { lighthouse, breakwater } = harbour;
  const r = lighthouse.island;
  const top = 0.5;
  parts.add(
    [
      paint(
        new CylinderGeometry(r * 0.92, r * 1.1, top - WATER_LEVEL + 1.5, 11),
        ISLAND_ROCK,
      ).translate(0, (top + WATER_LEVEL - 1.5) / 2, 0),
      paint(new CylinderGeometry(r * 0.8, r * 0.88, 0.12, 11), LAND_GRASS).translate(
        0,
        top + 0.06,
        0,
      ),
    ],
    lighthouse.x,
    0,
    lighthouse.z,
  );
  const { from, to } = breakwater;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const heading = Math.atan2(to.x - from.x, to.z - from.z);
  parts.add(
    [box(1.6, 0.5, length, 0, 0.12, 0, CONCRETE)],
    (from.x + to.x) / 2,
    0,
    (from.z + to.z) / 2,
    heading,
  );
  return parts.merge();
}

/** Granite: boulders down the shore and the breakwater, and the Shield's outcrops on the point. */
function Rocks({ harbour }: { harbour: HarbourLayout }) {
  const geometry = useMemo(() => new DodecahedronGeometry(1, 0), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new Matrix4();
    const turn = new Quaternion();
    const tilt = new Quaternion();
    const scale = new Vector3();
    const at = new Vector3();
    const up = new Vector3(0, 1, 0);
    const side = new Vector3(1, 0, 0);
    const color = new Color();
    harbour.rocks.forEach((r, i) => {
      // On land a rock sinks into the grass; offshore, into the water.
      const base = onLand(harbour.coast, r, 0.5) ? 0 : WATER_LEVEL;
      const tall = r.size * 0.7;
      turn.setFromAxisAngle(up, r.turn).multiply(tilt.setFromAxisAngle(side, (r.turn % 1) * 0.3));
      matrix.compose(
        at.set(r.x, base - tall * (2 * r.sink - 1), r.z),
        turn,
        scale.set(r.size, tall, r.size * 0.85),
      );
      m.setMatrixAt(i, matrix);
      m.setColorAt(i, color.set(ROCKS[i % ROCKS.length]));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [harbour]);
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, harbour.rocks.length]}
      castShadow
      receiveShadow
    >
      <meshLambertMaterial flatShading />
    </instancedMesh>
  );
}

// The land hides the water under it from the pointer: a click on the grass is not a click on the sea.
const stop = (event: ThreeEvent<MouseEvent>) => event.stopPropagation();

/**
 * The land round the bay: lawns, Front Street and Hill Street, the green's mown stripes, a stone
 * face along the shore, granite boulders where it meets the water, and the lighthouse's rock at
 * the end of the breakwater.
 */
export function HarbourLand({ harbour }: { harbour: HarbourLayout }) {
  const land = useMemo(() => buildLand(harbour), [harbour]);
  const patches = useMemo(() => buildPatches(harbour), [harbour]);
  const island = useMemo(() => buildIsland(harbour), [harbour]);
  useEffect(
    () => () => [land, patches, island].forEach((g) => g.dispose()),
    [land, patches, island],
  );

  return (
    <group onClick={stop}>
      <mesh geometry={land} receiveShadow>
        <meshLambertMaterial attach="material-0" color={LAND_GRASS} />
        <meshLambertMaterial attach="material-1" color={SHORE_STONE} flatShading />
      </mesh>
      <mesh geometry={patches} receiveShadow>
        <meshLambertMaterial
          vertexColors
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      <mesh geometry={island} castShadow receiveShadow>
        <meshLambertMaterial vertexColors flatShading />
      </mesh>
      <Rocks harbour={harbour} />
    </group>
  );
}

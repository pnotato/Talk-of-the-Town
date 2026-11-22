import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  HOME_DEPTH,
  HOME_ROOF_HEIGHT,
  HOME_WALL_HEIGHT,
  HOME_WIDTH,
  type TownHome,
} from "./layoutTown.ts";

const EAVES = 0.18;

// Muted so the blobs, not the houses, carry the colour later.
const WALLS = ["#f4ecdc", "#efe2c8", "#eadbc9", "#f2eacf", "#e5e3d6", "#ecdcd2", "#dfe4dc"];
const ROOFS = ["#b9654e", "#a65a46", "#c27c55", "#6f7f8c", "#8a6a50", "#9c5f5f", "#5f6b73"];
const DOOR = "#7a5338";
const WINDOW = "#5f7889";
const CHIMNEY = "#9b6a55";

// Same small integer hash for every home index, so colours never shuffle.
function hash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return (h ^ (h >>> 15)) >>> 0;
}

function paint(geometry: BufferGeometry, hex: string): BufferGeometry {
  const c = new Color(hex);
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

// A gable roof `span` across and `length` long, its ridge along local x.
function gable(span: number, length: number): BufferGeometry {
  const half = span / 2 + EAVES;
  const shape = new Shape([
    new Vector2(-half, 0),
    new Vector2(half, 0),
    new Vector2(0, HOME_ROOF_HEIGHT),
  ]);
  const run = length + 2 * EAVES;
  return new ExtrudeGeometry(shape, { depth: run, bevelEnabled: false })
    .rotateY(Math.PI / 2)
    .translate(-run / 2, HOME_WALL_HEIGHT, 0);
}

// One home in local space: footprint centred on the origin, front (door) facing +z. Two
// roofs: a ridge along the street, or a gable end facing it.
function buildHomeGeometries() {
  const walls = new BoxGeometry(HOME_WIDTH, HOME_WALL_HEIGHT, HOME_DEPTH).translate(
    0,
    HOME_WALL_HEIGHT / 2,
    0,
  );
  const sideRoof = gable(HOME_DEPTH, HOME_WIDTH);
  const frontRoof = gable(HOME_WIDTH, HOME_DEPTH).rotateY(Math.PI / 2);

  const front = HOME_DEPTH / 2;
  const details = mergeGeometries([
    paint(new BoxGeometry(0.62, 1.05, 0.08).translate(0, 0.525, front + 0.03), DOOR),
    paint(new BoxGeometry(0.5, 0.45, 0.06).translate(-0.88, 1.05, front + 0.02), WINDOW),
    paint(new BoxGeometry(0.5, 0.45, 0.06).translate(0.88, 1.05, front + 0.02), WINDOW),
    paint(new BoxGeometry(0.5, 0.45, 0.06).translate(-0.7, 1.05, -front - 0.02), WINDOW),
    paint(new BoxGeometry(0.5, 0.45, 0.06).translate(0.7, 1.05, -front - 0.02), WINDOW),
    paint(new BoxGeometry(0.06, 0.45, 0.5).translate(HOME_WIDTH / 2 + 0.02, 1.05, 0), WINDOW),
    paint(new BoxGeometry(0.06, 0.45, 0.5).translate(-HOME_WIDTH / 2 - 0.02, 1.05, 0), WINDOW),
    paint(
      new BoxGeometry(0.34, 0.8, 0.34).translate(
        HOME_WIDTH / 2 - 0.6,
        HOME_WALL_HEIGHT + 0.85,
        -0.5,
      ),
      CHIMNEY,
    ),
  ]);
  return { walls, sideRoof, frontRoof, details };
}

/** All homes as instanced meshes (walls, two kinds of roof, door/windows/chimney). */
export function TownHomes({ homes }: { homes: TownHome[] }) {
  const geometries = useMemo(() => buildHomeGeometries(), []);
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);

  const sideRoofed = useMemo(() => homes.filter((h) => h.roof === "side"), [homes]);
  const frontRoofed = useMemo(() => homes.filter((h) => h.roof === "front"), [homes]);

  const walls = useRef<InstancedMesh>(null);
  const details = useRef<InstancedMesh>(null);
  const sideRoofs = useRef<InstancedMesh>(null);
  const frontRoofs = useRef<InstancedMesh>(null);

  // Written once per layout, never per frame.
  useLayoutEffect(() => {
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const color = new Color();
    const place = (home: TownHome) =>
      matrix.compose(
        position.set(home.x, 0, home.z),
        rotation.setFromAxisAngle(up, home.rotationY),
        scale.set(home.width / HOME_WIDTH, home.heightScale, home.depth / HOME_DEPTH),
      );

    homes.forEach((home, i) => {
      place(home);
      walls.current?.setMatrixAt(i, matrix);
      details.current?.setMatrixAt(i, matrix);
      walls.current?.setColorAt(i, color.set(WALLS[hash(home.index, 1) % WALLS.length]));
    });
    for (const [mesh, group] of [
      [sideRoofs.current, sideRoofed],
      [frontRoofs.current, frontRoofed],
    ] as const) {
      group.forEach((home, i) => {
        mesh?.setMatrixAt(i, place(home));
        mesh?.setColorAt(i, color.set(ROOFS[hash(home.index, 2) % ROOFS.length]));
      });
    }

    for (const mesh of [walls.current, details.current, sideRoofs.current, frontRoofs.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Frustum culling caches the instances' bounding sphere; refresh it with the matrices.
      mesh.computeBoundingSphere();
    }
  }, [homes, sideRoofed, frontRoofed]);

  return (
    <group>
      <instancedMesh
        ref={walls}
        args={[geometries.walls, undefined, homes.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={sideRoofs}
        args={[geometries.sideRoof, undefined, sideRoofed.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={frontRoofs}
        args={[geometries.frontRoof, undefined, frontRoofed.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={details}
        args={[geometries.details, undefined, homes.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial vertexColors />
      </instancedMesh>
    </group>
  );
}

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
import { HOME_DEPTH, HOME_WIDTH, type TownHome } from "./layoutTown.ts";

const WALL_HEIGHT = 1.7; // a 1-unit adult blob fits under the door
const ROOF_HEIGHT = 1.1;
const EAVES = 0.18;

// Muted so the blobs, not the houses, carry the colour later.
const WALLS = ["#f4ecdc", "#efe2c8", "#eadbc9", "#f2eacf", "#e5e3d6", "#ecdcd2"];
const ROOFS = ["#b9654e", "#a65a46", "#c27c55", "#6f7f8c", "#8a6a50", "#9c5f5f"];
const DOOR = "#7a5338";
const WINDOW = "#5f7889";
const CHIMNEY = "#9b6a55";

// Same small integer hash for every home index, so colours and heights never shuffle.
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

// One home in local space: footprint centred on the origin, front (door) facing +z.
function buildHomeGeometries() {
  const walls = new BoxGeometry(HOME_WIDTH, WALL_HEIGHT, HOME_DEPTH).translate(
    0,
    WALL_HEIGHT / 2,
    0,
  );

  const halfSpan = HOME_DEPTH / 2 + EAVES;
  const gable = new Shape([
    new Vector2(-halfSpan, 0),
    new Vector2(halfSpan, 0),
    new Vector2(0, ROOF_HEIGHT),
  ]);
  const length = HOME_WIDTH + 2 * EAVES;
  // Extruded along z, then turned so the ridge runs along the street.
  const roof = new ExtrudeGeometry(gable, { depth: length, bevelEnabled: false })
    .rotateY(Math.PI / 2)
    .translate(-length / 2, WALL_HEIGHT, 0);

  const front = HOME_DEPTH / 2;
  const details = mergeGeometries([
    paint(new BoxGeometry(0.62, 1.05, 0.08).translate(0, 0.525, front + 0.03), DOOR),
    paint(new BoxGeometry(0.5, 0.45, 0.06).translate(-0.88, 1.05, front + 0.02), WINDOW),
    paint(new BoxGeometry(0.5, 0.45, 0.06).translate(0.88, 1.05, front + 0.02), WINDOW),
    paint(
      new BoxGeometry(0.34, 0.8, 0.34).translate(HOME_WIDTH / 2 - 0.6, WALL_HEIGHT + 0.85, -0.5),
      CHIMNEY,
    ),
  ]);

  return { walls, roof, details };
}

/** All homes as three instanced meshes (walls, roofs, door/windows/chimney) sharing matrices. */
export function TownHomes({ homes }: { homes: TownHome[] }) {
  const geometries = useMemo(() => buildHomeGeometries(), []);
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);

  const walls = useRef<InstancedMesh>(null);
  const roofs = useRef<InstancedMesh>(null);
  const details = useRef<InstancedMesh>(null);

  // Written once per layout, never per frame.
  useLayoutEffect(() => {
    const meshes = [walls.current, roofs.current, details.current];
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const color = new Color();

    homes.forEach((home, i) => {
      // Height varies a little per home; the footprint never does.
      scale.set(1, 0.92 + (hash(i, 3) % 100) / 400, 1);
      matrix.compose(
        position.set(home.x, 0, home.z),
        rotation.setFromAxisAngle(up, home.rotationY),
        scale,
      );
      for (const mesh of meshes) mesh?.setMatrixAt(i, matrix);
      walls.current?.setColorAt(i, color.set(WALLS[hash(i, 1) % WALLS.length]));
      roofs.current?.setColorAt(i, color.set(ROOFS[hash(i, 2) % ROOFS.length]));
    });

    for (const mesh of meshes) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Frustum culling caches the instances' bounding sphere; refresh it with the matrices.
      mesh.computeBoundingSphere();
    }
  }, [homes]);

  const count = homes.length;
  return (
    <group>
      <instancedMesh
        ref={walls}
        args={[geometries.walls, undefined, count]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={roofs}
        args={[geometries.roof, undefined, count]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={details}
        args={[geometries.details, undefined, count]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial vertexColors />
      </instancedMesh>
    </group>
  );
}

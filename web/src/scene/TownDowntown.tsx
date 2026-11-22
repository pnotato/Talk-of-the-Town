import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ROOF_PLANT, type TownBuilding } from "./layoutTown.ts";

// Muted brick, cream and painted fronts, like an old Ontario main street.
const FACADES = ["#c98e6f", "#b9775c", "#e4d3b0", "#c7cdb5", "#d9c2a7", "#a9b7c0", "#dcb39b"];
const AWNINGS = ["#b8574f", "#5f8f8a", "#c9a24e", "#5b7a99", "#8a6d94", "#6f8f5a"];
const CREAM = "#f1e8d4";
const GLASS = "#4f6474";
const WOOD = "#6e4a33";
const SIGN = "#efe6d2";

const BRICK = "#b46c55"; // the town hall
const STONE = "#ece2cc";
const SLATE = "#69727c";
const COPPER = "#82a796"; // an old copper roof gone green
const CLOCK = "#f7f3e8";
const HANDS = "#2c2c2c";

// Same hash for a building index every time, so colours never shuffle.
function hash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return (h ^ (h >>> 15)) >>> 0;
}

// A box, painted, centred at (x, y, z) in a building's own space (front facing +z).
function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string) {
  return paint(new BoxGeometry(w, h, d).translate(x, y, z), hex);
}

function paint(geometry: BufferGeometry, hex: string): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new Color(hex);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  // Only what every part shares, so they merge.
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "color") g.deleteAttribute(name);
  }
  return g;
}

function darker(hex: string, by: number): string {
  return `#${new Color(hex).multiplyScalar(by).getHexString()}`;
}

// A two-storey shop: storefront glass and a door under a striped awning, a sign band, upstairs
// windows with sills, and a cornice along the top.
function shop(b: TownBuilding, i: number): BufferGeometry[] {
  const { width: w, depth: d, height: h } = b;
  const facade = FACADES[hash(i, 1) % FACADES.length];
  const awning = AWNINGS[hash(i, 2) % AWNINGS.length];
  const front = d / 2;
  const parts = [
    box(w, h, d, 0, h / 2, 0, facade),
    // The cornice stands a little proud of the roof, so the two never share a plane.
    box(w + 0.08, 0.32, d + 0.08, 0, h - 0.12, 0, darker(facade, 0.78)),
    box(w - 0.3, 0.45, 0.06, 0, 2.08, front + 0.03, SIGN),
  ];
  // Door at one end of the shopfront, glass the rest of the way.
  const doorSide = hash(i, 3) % 2 === 0 ? -1 : 1;
  const doorX = doorSide * (w / 2 - 0.75);
  parts.push(box(0.7, 1.5, 0.08, doorX, 0.75, front + 0.04, WOOD));
  const glassW = w - 2.1;
  if (glassW > 0.4) {
    parts.push(box(glassW, 1.25, 0.06, -doorSide * 0.35, 0.95, front + 0.03, GLASS));
  }
  // Upstairs windows, front and back, and a back door onto the yard.
  const windows = Math.max(1, Math.floor((w - 0.4) / 1.4));
  for (let k = 0; k < windows; k++) {
    const x = (k - (windows - 1) / 2) * ((w - 0.4) / windows);
    for (const side of [1, -1]) {
      parts.push(box(0.6, 0.85, 0.06, x, h - 1.15, side * (front + 0.03), GLASS));
      parts.push(box(0.75, 0.08, 0.14, x, h - 1.62, side * (front + 0.06), CREAM));
    }
  }
  parts.push(box(0.7, 1.4, 0.08, -doorX, 0.7, -front - 0.04, WOOD));
  // Plant on about half the roofs.
  if (hash(i, 4) % 2 === 0) {
    const x = ((hash(i, 5) % 100) / 100 - 0.5) * (w - 1.6);
    parts.push(box(0.9, ROOF_PLANT, 0.8, x, h + ROOF_PLANT / 2, -0.6, "#9a9a96"));
  }
  // The awning slopes down and out over the shopfront, in stripes.
  const awningW = w - 0.5;
  const stripes = Math.max(3, Math.round(awningW / 0.45));
  const tilt = new Matrix4().makeRotationX(0.42);
  for (let k = 0; k < stripes; k++) {
    const x = -awningW / 2 + ((k + 0.5) * awningW) / stripes;
    const stripe = box(awningW / stripes, 0.06, 1.1, 0, 0, 0.55, k % 2 ? CREAM : awning);
    parts.push(stripe.applyMatrix4(tilt).translate(x, 1.92, front));
  }
  return parts;
}

// The town hall: red brick with stone trim, a pillared portico over the door, and a clock
// tower with a copper roof rising from the middle of its slate roof.
function townHall(b: TownBuilding): BufferGeometry[] {
  const { width: w, depth: d } = b;
  const porch = 1.2;
  const bodyD = d - porch;
  const bodyZ = -porch / 2; // the main block sits behind the portico
  const front = bodyZ + bodyD / 2;
  const walls = 4.6;
  const parts = [
    box(w + 0.4, 0.35, bodyD + 0.4, 0, 0.175, bodyZ, STONE),
    box(w, walls, bodyD, 0, walls / 2, bodyZ, BRICK),
    box(w + 0.3, 0.3, bodyD + 0.3, 0, walls, bodyZ, STONE),
    box(w + 0.3, 0.3, bodyD + 0.3, 0, 2.3, bodyZ, STONE), // a band between the storeys
  ];
  // A hipped slate roof: a square frustum stretched over the block.
  const roofH = b.height - walls - 0.15;
  parts.push(
    paint(
      new CylinderGeometry(0.42, 1, 1, 4, 1)
        .rotateY(Math.PI / 4)
        .scale((w + 0.5) / Math.SQRT2, roofH, (bodyD + 0.5) / Math.SQRT2)
        .translate(0, walls + 0.15 + roofH / 2, bodyZ),
      SLATE,
    ),
  );
  // Two rows of tall windows across the front and sides, leaving the middle for the portico.
  for (const y of [1.25, 3.45]) {
    for (let x = -w / 2 + 1.1; x <= w / 2 - 1; x += 1.6) {
      if (Math.abs(x) < 3.2) continue;
      parts.push(box(0.75, 1.25, 0.06, x, y, front + 0.03, GLASS));
      parts.push(box(0.9, 0.12, 0.12, x, y + 0.72, front + 0.05, STONE));
    }
    for (const side of [-1, 1]) {
      for (let z = bodyZ - bodyD / 2 + 1.2; z <= bodyZ + bodyD / 2 - 1; z += 1.6) {
        parts.push(box(0.06, 1.25, 0.75, side * (w / 2 + 0.03), y, z, GLASS));
      }
    }
  }
  // The portico: steps, four columns, an entablature and a pediment over the door.
  const porchZ = front + porch / 2;
  parts.push(box(6.4, 0.35, porch + 0.2, 0, 0.175, porchZ, STONE));
  parts.push(box(1.5, 2.3, 0.08, 0, 1.5, front + 0.04, WOOD));
  for (const x of [-2.4, -0.8, 0.8, 2.4]) {
    parts.push(
      paint(
        new CylinderGeometry(0.2, 0.24, 3.9, 10).translate(x, 0.35 + 1.95, porchZ + 0.15),
        STONE,
      ),
    );
  }
  parts.push(box(6.2, 0.45, porch + 0.1, 0, 4.47, porchZ - 0.05, STONE));
  const pediment = new Shape([new Vector2(-3.2, 0), new Vector2(3.2, 0), new Vector2(0, 1.1)]);
  parts.push(
    paint(
      new ExtrudeGeometry(pediment, { depth: porch + 0.1, bevelEnabled: false }).translate(
        0,
        4.7,
        porchZ - 0.05 - (porch + 0.1) / 2,
      ),
      STONE,
    ),
  );
  // The clock tower, in the building's own space.
  if (b.tower) {
    const c = Math.cos(b.rotationY);
    const s = Math.sin(b.rotationY);
    const dx = b.tower.x - b.x;
    const dz = b.tower.z - b.z;
    const tx = c * dx - s * dz;
    const tz = s * dx + c * dz;
    const size = b.tower.width;
    const shaftTop = b.tower.height - 2.6;
    const shaftBottom = walls;
    const shaftH = shaftTop - shaftBottom;
    parts.push(box(size, shaftH, size, tx, shaftBottom + shaftH / 2, tz, BRICK));
    parts.push(box(size + 0.3, 0.3, size + 0.3, tx, shaftTop, tz, STONE));
    // A clock on each face.
    const clockY = shaftTop - 0.95;
    for (let k = 0; k < 4; k++) {
      const turn = new Matrix4().makeRotationY((k * Math.PI) / 2);
      const at = new Matrix4().makeTranslation(tx, clockY, tz);
      const face = paint(
        new CylinderGeometry(0.72, 0.72, 0.06, 20)
          .rotateX(Math.PI / 2)
          .translate(0, 0, size / 2 + 0.03),
        CLOCK,
      );
      const hour = box(0.08, 0.42, 0.04, 0, 0.18, size / 2 + 0.08, HANDS);
      const minute = box(0.06, 0.6, 0.04, 0, 0.27, size / 2 + 0.09, HANDS).applyMatrix4(
        new Matrix4().makeRotationZ(-2.1).setPosition(0, 0, 0),
      );
      for (const part of [face, hour, minute]) parts.push(part.applyMatrix4(turn).applyMatrix4(at));
    }
    const capH = b.tower.height - shaftTop - 0.15;
    parts.push(
      paint(
        new CylinderGeometry(0, 1, 1, 4, 1)
          .rotateY(Math.PI / 4)
          .scale((size + 0.4) / Math.SQRT2, capH, (size + 0.4) / Math.SQRT2)
          .translate(tx, shaftTop + 0.15 + capH / 2, tz),
        COPPER,
      ),
    );
  }
  return parts;
}

// Every shop and the town hall, placed and merged into one geometry: one draw call.
function buildDowntown(buildings: TownBuilding[]): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  buildings.forEach((b, i) => {
    matrix.compose(new Vector3(b.x, 0, b.z), turn.setFromAxisAngle(up, b.rotationY), one);
    for (const part of b.kind === "shop" ? shop(b, i) : townHall(b)) {
      parts.push(part.applyMatrix4(matrix));
    }
  });
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/** Main Street's shops and the town hall, in code, as one mesh. */
export function TownDowntown({ buildings }: { buildings: TownBuilding[] }) {
  const geometry = useMemo(() => buildDowntown(buildings), [buildings]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshLambertMaterial vertexColors flatShading />
    </mesh>
  );
}

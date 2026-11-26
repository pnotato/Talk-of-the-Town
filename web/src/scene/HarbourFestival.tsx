import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Line,
  Matrix4,
  type Mesh,
  type MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { useReducedMotion } from "./blobMedia.ts";
import { box, cylinder, paint, partsBuilder, triangle } from "./harbourGeometry.ts";
import { smoothstep } from "./harbourMotion.ts";
import { useToy } from "./harbourToys.ts";
import {
  type HarbourChair,
  type HarbourFestoon,
  type HarbourKite,
  type HarbourLayout,
  type HarbourProp,
  type HarbourStall,
  POLE_HEIGHT,
  STALL_HEIGHT,
} from "./layoutHarbour.ts";
import { seededRandom } from "./mapLayout.ts";

const WOOD = "#a47a55";
const DARK_WOOD = "#7d5c41";
const IRON = "#2f3b36";
const WHITE = "#f6f1e7";
const CREAM = "#f3ead8";
const SOIL = "#6f5a44";
const LEAF = "#6f9a5a";
const FLOWERS = ["#d77a6f", "#e2bf5c", "#a483b8", "#f0e6da", "#e39a6a"];
// Awning stripes, each paired with cream.
const AWNINGS = ["#d1493d", "#3a8fa3", "#e3b23c", "#5c9e5a", "#33618f", "#e07b39"];
// What each stall sells, as little piles of colour on its counter.
const GOODS = [
  ["#e88a2d", "#f09a3a", "#d97a24"], // pumpkins
  ["#c73a32", "#d9503e", "#9fbf4f"], // apples
  ["#b8752a", "#c98a34", "#a8641f"], // maple syrup
  ["#e06d8a", "#f2c84b", "#a985c9"], // flowers
  ["#c99a5f", "#b78549", "#ddb67a"], // bread
  ["#8a4f7d", "#d26b5c", "#e9c46a"], // jams and pies
];
const CHAIRS = [
  "#d1453b",
  "#e2b13c",
  "#3d8fa3",
  "#5c9e5a",
  "#e07b39",
  "#2f5f8a",
  "#c7c2b4",
  "#9b5fa3",
];
const KITES = [
  ["#e2574c", "#f4d35e"],
  ["#3a8fa3", "#f6f1e7"],
  ["#8f6bb3", "#f29e4c"],
];
const BULBS = [
  "#fff1c9",
  "#ffe3a1",
  "#fff1c9",
  "#ffb48a",
  "#fff1c9",
  "#bfe3ff",
  "#ffe3a1",
  "#c9f0b0",
];
const BUNTING = ["#d1493d", "#f3ead8", "#3a8fa3", "#e3b23c", "#5c9e5a"];

const BULB_EVERY = 1.05;
const FLAG_EVERY = 0.9;

function stallParts(s: HarbourStall): BufferGeometry[] {
  const { width: w, depth: d } = s;
  const colour = AWNINGS[s.awning % AWNINGS.length];
  const parts: BufferGeometry[] = [
    box(w, 0.95, 0.75, 0, 0.475, d / 2 - 0.375, WOOD),
    box(w + 0.02, 0.42, 0.04, 0, 0.62, d / 2 + 0.01, colour),
    box(w, 2.1, 0.08, 0, 1.05, -d / 2 + 0.04, CREAM),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        box(
          0.12,
          STALL_HEIGHT - 0.25,
          0.12,
          (sx * (w - 0.2)) / 2,
          (STALL_HEIGHT - 0.25) / 2,
          (sz * (d - 0.2)) / 2,
          WHITE,
        ),
      );
    }
  }
  // The awning slopes down to the front in stripes, with a scalloped valance along its edge.
  const front = { y: STALL_HEIGHT - 0.45, z: d / 2 + 0.35 };
  const back = { y: STALL_HEIGHT, z: -d / 2 };
  const slope = Math.atan2(back.y - front.y, front.z - back.z);
  const length = Math.hypot(back.y - front.y, front.z - back.z);
  const stripes = 8;
  for (let k = 0; k < stripes; k++) {
    const x = -w / 2 - 0.1 + ((w + 0.2) * (k + 0.5)) / stripes;
    parts.push(
      paint(
        box((w + 0.2) / stripes, 0.06, length, 0, 0, 0, k % 2 === 0 ? colour : CREAM)
          .rotateX(slope)
          .translate(x, (front.y + back.y) / 2, (front.z + back.z) / 2),
        k % 2 === 0 ? colour : CREAM,
      ),
    );
  }
  const scallops = 10;
  for (let k = 0; k < scallops; k++) {
    const x0 = -w / 2 - 0.1 + ((w + 0.2) * k) / scallops;
    const x1 = -w / 2 - 0.1 + ((w + 0.2) * (k + 1)) / scallops;
    parts.push(
      triangle(
        [x0, front.y, front.z],
        [(x0 + x1) / 2, front.y - 0.28, front.z],
        [x1, front.y, front.z],
        k % 2 === 0 ? colour : CREAM,
      ),
    );
  }
  // Goods piled on the counter.
  const random = seededRandom(31 + s.awning);
  const goods = GOODS[s.awning % GOODS.length];
  for (let k = 0; k < 9; k++) {
    const x = -w / 2 + 0.35 + ((w - 0.7) * k) / 8 + (random() - 0.5) * 0.15;
    const r = 0.13 + random() * 0.06;
    parts.push(
      paint(
        new SphereGeometry(r, 7, 5)
          .scale(1, 0.85, 1)
          .translate(x, 0.95 + r * 0.8, d / 2 - 0.4 + (random() - 0.5) * 0.25),
        goods[k % goods.length],
      ),
    );
  }
  return parts;
}

function benchParts(w: number): BufferGeometry[] {
  return [
    box(w, 0.1, 0.45, 0, 0.45, 0.05, WOOD),
    box(w, 0.4, 0.08, 0, 0.75, -0.2, WOOD),
    box(0.1, 0.45, 0.5, -w / 2 + 0.2, 0.225, 0, IRON),
    box(0.1, 0.45, 0.5, w / 2 - 0.2, 0.225, 0, IRON),
  ];
}

function planterParts(w: number, d: number, seed: number): BufferGeometry[] {
  const parts = [
    box(w, 0.6, d, 0, 0.3, 0, DARK_WOOD),
    box(w - 0.2, 0.06, d - 0.2, 0, 0.6, 0, SOIL),
  ];
  const random = seededRandom(seed);
  for (let k = 0; k < Math.round(w * d * 2.2); k++) {
    const x = (random() - 0.5) * (w - 0.4);
    const z = (random() - 0.5) * (d - 0.4);
    const colour = random() < 0.3 ? LEAF : FLOWERS[Math.floor(random() * FLOWERS.length)];
    parts.push(
      paint(new SphereGeometry(0.16 + random() * 0.08, 6, 4).translate(x, 0.72, z), colour),
    );
  }
  return parts;
}

function poleParts(i: number): BufferGeometry[] {
  return [
    cylinder(0.07, 0.09, POLE_HEIGHT, 8, 0, POLE_HEIGHT / 2, 0, WHITE),
    cylinder(0.16, 0.2, 0.25, 8, 0, 0.125, 0, IRON),
    paint(new SphereGeometry(0.12, 8, 6).translate(0, POLE_HEIGHT + 0.08, 0), "#d9b45a"),
    // A pennant flying off the top.
    triangle(
      [0, POLE_HEIGHT + 0.05, 0],
      [0, POLE_HEIGHT - 0.35, 0],
      [0.75, POLE_HEIGHT - 0.15, 0.05],
      AWNINGS[i % AWNINGS.length],
    ),
  ];
}

function telescopeParts(): BufferGeometry[] {
  return [
    cylinder(0.08, 0.1, 1.1, 8, 0, 0.55, 0, IRON),
    box(0.5, 0.32, 0.36, 0, 1.25, 0, "#3a8fa3"),
    paint(
      cylinder(0.09, 0.11, 0.42, 8, 0, 0, 0, "#3a8fa3")
        .rotateX(Math.PI / 2 - 0.25)
        .translate(-0.12, 1.32, 0.3),
      "#3a8fa3",
    ),
    paint(
      cylinder(0.09, 0.11, 0.42, 8, 0, 0, 0, "#3a8fa3")
        .rotateX(Math.PI / 2 - 0.25)
        .translate(0.12, 1.32, 0.3),
      "#3a8fa3",
    ),
  ];
}

function cartParts(): BufferGeometry[] {
  const parts = [
    box(2.0, 0.85, 1.1, 0, 0.75, 0, "#f2b8c6"),
    box(2.04, 0.18, 1.14, 0, 1.2, 0, "#bfe3d6"),
    cylinder(0.32, 0.32, 0.12, 12, -0.7, 0.32, 0.6, IRON).rotateX(Math.PI / 2),
    cylinder(0.04, 0.04, 1.6, 6, 0.6, 1.95, 0, WHITE),
  ];
  // A striped umbrella.
  const segments = 8;
  for (let k = 0; k < segments; k++) {
    const a0 = (k / segments) * Math.PI * 2;
    const a1 = ((k + 1) / segments) * Math.PI * 2;
    const r = 1.05;
    parts.push(
      triangle(
        [0.6, 2.95, 0],
        [0.6 + Math.cos(a1) * r, 2.55, Math.sin(a1) * r],
        [0.6 + Math.cos(a0) * r, 2.55, Math.sin(a0) * r],
        k % 2 === 0 ? "#e2574c" : WHITE,
      ),
    );
  }
  return parts;
}

// A Muskoka chair: a slatted seat sloping back, a tall raked back and broad flat arms.
function chairParts(c: HarbourChair): BufferGeometry[] {
  const colour = CHAIRS[c.colour % CHAIRS.length];
  return [
    paint(box(0.7, 0.06, 0.75, 0, 0, 0, colour).rotateX(-0.18).translate(0, 0.38, 0.05), colour),
    paint(box(0.7, 1.05, 0.06, 0, 0, 0, colour).rotateX(-0.45).translate(0, 0.82, -0.42), colour),
    box(0.14, 0.05, 0.85, -0.42, 0.62, 0.05, colour),
    box(0.14, 0.05, 0.85, 0.42, 0.62, 0.05, colour),
    box(0.08, 0.62, 0.08, -0.42, 0.31, 0.38, colour),
    box(0.08, 0.62, 0.08, 0.42, 0.31, 0.38, colour),
    box(0.08, 0.4, 0.08, -0.38, 0.2, -0.3, colour),
    box(0.08, 0.4, 0.08, 0.38, 0.2, -0.3, colour),
  ];
}

// A picnic table with its two benches and a red-and-white checked cloth.
function picnicParts(w: number, d: number): BufferGeometry[] {
  const parts = [
    box(w, 0.07, d * 0.5, 0, 0.76, 0, WOOD),
    box(w, 0.06, 0.3, 0, 0.45, d / 2 - 0.15, WOOD),
    box(w, 0.06, 0.3, 0, 0.45, -d / 2 + 0.15, WOOD),
  ];
  for (const x of [-w / 2 + 0.25, w / 2 - 0.25]) {
    parts.push(
      paint(
        box(0.08, 0.85, 0.08, 0, 0, 0, DARK_WOOD).rotateX(0.55).translate(x, 0.4, 0.2),
        DARK_WOOD,
      ),
      paint(
        box(0.08, 0.85, 0.08, 0, 0, 0, DARK_WOOD).rotateX(-0.55).translate(x, 0.4, -0.2),
        DARK_WOOD,
      ),
    );
  }
  const checks = 6;
  for (let i = 0; i < checks; i++) {
    for (let k = 0; k < 3; k++) {
      const red = (i + k) % 2 === 0;
      parts.push(
        box(
          (w * 0.7) / checks,
          0.012,
          (d * 0.42) / 3,
          -w * 0.35 + ((w * 0.7) / checks) * (i + 0.5),
          0.8,
          -d * 0.21 + ((d * 0.42) / 3) * (k + 0.5),
          red ? "#d1493d" : "#f6f1e7",
        ),
      );
    }
  }
  return parts;
}

function furniture(harbour: HarbourLayout): BufferGeometry {
  const parts = partsBuilder();
  const place = (p: HarbourProp, pieces: BufferGeometry[]) =>
    parts.add(pieces, p.x, 0, p.z, p.rotationY);
  harbour.props.forEach((p, i) => {
    if (p.kind === "bench") place(p, benchParts(p.width));
    else if (p.kind === "planter") place(p, planterParts(p.width, p.depth, i + 7));
    else if (p.kind === "pole") place(p, poleParts(i));
    else if (p.kind === "telescope") place(p, telescopeParts());
    else if (p.kind === "cart") place(p, cartParts());
  });
  for (const s of harbour.stalls) parts.add(stallParts(s), s.x, 0, s.z, s.rotationY);
  for (const t of harbour.picnics)
    parts.add(picnicParts(t.width, t.depth), t.x, 0, t.z, t.rotationY);
  for (const c of harbour.chairs) {
    // The chairs sit on the outcrops' tops.
    parts.add(chairParts(c), c.x, 0.55, c.z, c.rotationY);
  }
  return parts.merge();
}

/** A point `t` of the way along a festoon, sagging in the middle. Writes into `out`. */
function along(f: HarbourFestoon, t: number, out: Vector3): Vector3 {
  return out.set(
    f.from.x + (f.to.x - f.from.x) * t,
    f.from.y + (f.to.y - f.from.y) * t - f.sag * 4 * t * (1 - t),
    f.from.z + (f.to.z - f.from.z) * t,
  );
}

// The strings themselves, their bulbs, and bunting on the swags along the railings.
function festoonGeometry(festoons: HarbourFestoon[]) {
  const wire: number[] = [];
  const bulbs: Vector3[] = [];
  const flags = partsBuilder();
  const a = new Vector3();
  const b = new Vector3();
  festoons.forEach((f, i) => {
    const length = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y, f.to.z - f.from.z);
    const steps = Math.max(6, Math.round(length * 2));
    for (let k = 0; k < steps; k++) {
      along(f, k / steps, a);
      along(f, (k + 1) / steps, b);
      wire.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    // The canopy over the carousel hangs bulbs; the swags along the railings hang bunting.
    const canopy = f.from.y > POLE_HEIGHT;
    if (canopy) {
      const count = Math.round(length / BULB_EVERY);
      for (let k = 1; k < count; k++) bulbs.push(along(f, k / count, new Vector3()));
      return;
    }
    const count = Math.round(length / FLAG_EVERY);
    for (let k = 0; k < count; k++) {
      along(f, (k + 0.15) / count, a);
      along(f, (k + 0.85) / count, b);
      const colour = BUNTING[(k + i) % BUNTING.length];
      flags.add([
        triangle(
          [a.x, a.y, a.z],
          [(a.x + b.x) / 2, (a.y + b.y) / 2 - 0.42, (a.z + b.z) / 2],
          [b.x, b.y, b.z],
          colour,
        ),
      ]);
    }
  });
  return { wire, bulbs, flags: flags.merge() };
}

function Festoons({ festoons }: { festoons: HarbourFestoon[] }) {
  const { wire, bulbs, flags } = useMemo(() => festoonGeometry(festoons), [festoons]);
  const lines = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(wire, 3));
    return g;
  }, [wire]);
  const bulb = useMemo(() => new IcosahedronGeometry(0.12, 0), []);
  useEffect(() => () => [lines, bulb, flags].forEach((g) => g.dispose()), [lines, bulb, flags]);
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new Matrix4();
    const color = new Color();
    bulbs.forEach((p, i) => {
      m.setMatrixAt(i, matrix.makeTranslation(p));
      m.setColorAt(i, color.set(BULBS[i % BULBS.length]));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [bulbs]);
  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#3b3a36" />
      </lineSegments>
      <instancedMesh ref={mesh} args={[bulb, undefined, bulbs.length]}>
        <meshBasicMaterial />
      </instancedMesh>
      <mesh geometry={flags} castShadow>
        <meshLambertMaterial vertexColors side={2} />
      </mesh>
    </group>
  );
}

const KITE = { width: 2.1, height: 2.7, tail: 8 };
const KITE_LOOP = { seconds: 2.8, radius: 3.4 };

// A diamond kite in its own space, facing +z: two colours split down the middle, and a cross spar.
function kiteParts(colours: string[]): BufferGeometry[] {
  const w = KITE.width / 2;
  const top = KITE.height * 0.62;
  const bottom = -KITE.height * 0.38;
  return [
    triangle([0, top, 0], [-w, 0, 0], [0, bottom, 0], colours[0]),
    triangle([0, top, 0], [0, bottom, 0], [w, 0, 0], colours[1]),
    box(KITE.width, 0.04, 0.04, 0, 0, -0.03, DARK_WOOD),
  ];
}

/**
 * A kite on the breeze over the green, its string tied to the top of a festoon pole. It bobs and
 * sways; clicked, it loops the loop.
 */
function Kite({ kite, still }: { kite: HarbourKite; still: boolean }) {
  const toy = useToy(KITE_LOOP.seconds, !still, 0.01, false);
  const body = useMemo(() => {
    const parts = partsBuilder();
    parts.add(kiteParts(KITES[kite.colour % KITES.length]));
    return parts.merge();
  }, [kite.colour]);
  // The tail: bows hanging in a line below the kite, in its own group so it can trail.
  const bow = useMemo(() => {
    const parts = partsBuilder();
    parts.add([
      triangle(
        [0, 0, 0],
        [-0.34, 0.16, 0],
        [-0.34, -0.16, 0],
        KITES[kite.colour % KITES.length][1],
      ),
      triangle([0, 0, 0], [0.34, -0.16, 0], [0.34, 0.16, 0], KITES[kite.colour % KITES.length][1]),
    ]);
    return parts.merge();
  }, [kite.colour]);
  const string = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  useEffect(() => () => [body, bow, string].forEach((g) => g.dispose()), [body, bow, string]);
  const group = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const line = useRef<Line>(null);
  const phase = kite.colour * 1.9;

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = still ? 0 : clock.elapsedTime + phase;
    const now = clock.elapsedTime;
    const since = toy.since(now);
    // Bob and sway on the breeze.
    let x = kite.x + Math.sin(t * 0.55) * 1.4;
    let y = kite.height + Math.sin(t * 0.9) * 0.8;
    const z = kite.z + Math.cos(t * 0.4) * 0.8;
    let roll = Math.sin(t * 0.7) * 0.25;
    if (since < KITE_LOOP.seconds) {
      // A loop up and over in the wind's plane, spinning once as it goes.
      const a = smoothstep(0, 1, since / KITE_LOOP.seconds) * Math.PI * 2;
      x += Math.sin(a) * KITE_LOOP.radius;
      y += (1 - Math.cos(a)) * KITE_LOOP.radius;
      roll -= a;
    }
    g.position.set(x, y, z);
    g.rotation.set(-0.5, 0, roll);
    if (tail.current) {
      const kids = tail.current.children;
      for (let k = 0; k < kids.length; k++) {
        const drop = 0.85 * (k + 1);
        kids[k].position.set(
          Math.sin(t * 2.1 - k * 0.6) * 0.15 * (k + 1),
          -KITE.height * 0.38 - drop,
          0,
        );
        kids[k].rotation.z = Math.sin(t * 2.6 - k * 0.8) * 0.5;
      }
    }
    // The string runs from the pole top to the kite's bridle.
    const attribute = string.getAttribute("position");
    attribute.setXYZ(0, kite.anchor.x, POLE_HEIGHT, kite.anchor.z);
    attribute.setXYZ(1, x, y - 0.2, z);
    attribute.needsUpdate = true;
    if (line.current) line.current.geometry.computeBoundingSphere();
  });

  return (
    <>
      <group ref={group} {...toy.handlers}>
        <mesh geometry={body} castShadow>
          <meshLambertMaterial vertexColors side={2} />
        </mesh>
        <group ref={tail}>
          {Array.from({ length: KITE.tail }, (_, k) => (
            <mesh key={k} geometry={bow}>
              <meshLambertMaterial vertexColors side={2} />
            </mesh>
          ))}
        </group>
        {/* A generous invisible target, so a small kite in the sky is easy to click. */}
        <mesh visible={false} scale={[3.4, 4.2, 0.8]}>
          <boxGeometry />
        </mesh>
      </group>
      <lineSegments ref={line} geometry={string}>
        <lineBasicMaterial color="#5a5650" />
      </lineSegments>
    </>
  );
}

const BELL = { seconds: 3.2, height: 1.9 };

/** The harbour bell on its frame at the pier head. Clicked, it swings and rings out over the water. */
function Bell({ prop, still }: { prop: HarbourProp; still: boolean }) {
  const toy = useToy(BELL.seconds, !still, 0.05, false);
  const frame = useMemo(() => {
    const parts = partsBuilder();
    parts.add([
      box(1.1, 0.12, 0.5, 0, 0.06, 0, DARK_WOOD),
      box(0.12, BELL.height + 0.35, 0.12, -0.45, (BELL.height + 0.35) / 2, 0, DARK_WOOD),
      box(0.12, BELL.height + 0.35, 0.12, 0.45, (BELL.height + 0.35) / 2, 0, DARK_WOOD),
      box(1.1, 0.14, 0.18, 0, BELL.height + 0.35, 0, DARK_WOOD),
    ]);
    return parts.merge();
  }, []);
  const bell = useMemo(() => {
    const parts = partsBuilder();
    parts.add([
      cylinder(0.12, 0.34, 0.5, 12, 0, -0.3, 0, "#c99a3c"),
      cylinder(0.36, 0.36, 0.06, 12, 0, -0.56, 0, "#b5882f"),
      paint(new SphereGeometry(0.07, 6, 4).translate(0, -0.62, 0), "#8a6a2a"),
    ]);
    return parts.merge();
  }, []);
  useEffect(() => () => [frame, bell].forEach((g) => g.dispose()), [frame, bell]);
  const swing = useRef<Group>(null);
  const rings = useRef<Mesh[]>([]);

  useFrame(({ clock }) => {
    const since = toy.since(clock.elapsedTime);
    const going = since < BELL.seconds;
    const left = going ? 1 - since / BELL.seconds : 0;
    if (swing.current) swing.current.rotation.x = going ? Math.sin(since * 9) * 0.55 * left : 0;
    // Two rings spread out from the bell with each stroke, fading as they go.
    rings.current.forEach((ring, k) => {
      if (!ring) return;
      const age = going ? (since + k * 0.45) % 0.9 : 0;
      ring.visible = going && left > 0.08;
      const r = 0.4 + age * 4.5;
      ring.scale.set(r, r, r);
      (ring.material as MeshBasicMaterial).opacity = 0.55 * left * (1 - age / 0.9);
    });
  });

  return (
    <group position={[prop.x, 0, prop.z]} rotation-y={prop.rotationY} {...toy.handlers}>
      <mesh geometry={frame} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <group ref={swing} position-y={BELL.height + 0.28}>
        <mesh geometry={bell} castShadow>
          <meshLambertMaterial vertexColors />
        </mesh>
      </group>
      {[0, 1].map((k) => (
        <mesh
          key={k}
          ref={(m) => {
            if (m) rings.current[k] = m;
          }}
          position-y={BELL.height - 0.2}
          rotation-x={-Math.PI / 2}
          visible={false}
        >
          <ringGeometry args={[0.92, 1, 40]} />
          <meshBasicMaterial color="#fff7dc" transparent depthWrite={false} side={2} />
        </mesh>
      ))}
      {/* Easy to hit: the whole frame and the air in it. */}
      <mesh visible={false} position-y={1.2} scale={[1.4, 2.6, 0.9]}>
        <boxGeometry />
      </mesh>
    </group>
  );
}

/**
 * The festival: market stalls along the green, benches facing the water, planters, the festoon
 * poles and their canopy of lights over the carousel, bunting along the railings, an ice cream
 * cart, telescopes and the bell at the pier head, Muskoka chairs on the rocks and kites overhead.
 */
export function HarbourFestival({ harbour }: { harbour: HarbourLayout }) {
  const still = useReducedMotion();
  const geometry = useMemo(() => furniture(harbour), [harbour]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const bell = harbour.props.find((p) => p.kind === "bell");
  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshLambertMaterial vertexColors side={2} />
      </mesh>
      <Festoons festoons={harbour.festoons} />
      {harbour.kites.map((k) => (
        <Kite key={k.colour} kite={k} still={still} />
      ))}
      {bell && <Bell prop={bell} still={still} />}
    </group>
  );
}

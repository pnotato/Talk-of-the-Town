import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type BufferGeometry,
  Color,
  type Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { useReducedMotion } from "./blobMedia.ts";
import { box, cylinder, paint, partsBuilder, triangle } from "./harbourGeometry.ts";
import { useToy } from "./harbourToys.ts";
import type { HarbourLayout } from "./layoutHarbour.ts";

const GOLD = "#d9b45a";
const CREAM = "#f6efdf";
const RED = "#cf4b42";
const WHITE = "#f7f4ee";
const STEEL = "#e9e6df";
const CONCRETE = "#c9c0ae";
const WOOD = "#a47a55";
// The carousel's horses, and the wheel's gondolas in a soft rainbow.
const HORSES = [
  "#f6f1e7",
  "#e9d6b8",
  "#c9d9e6",
  "#f0c9c3",
  "#d8cbe6",
  "#f6f1e7",
  "#e9d6b8",
  "#cfe3c8",
];
const GONDOLAS = [
  "#e2574c",
  "#ef8a3c",
  "#f2c14e",
  "#8cc56b",
  "#3fa39a",
  "#4b8fd1",
  "#7d6bc4",
  "#d16ba5",
];
const BULB = "#fff1c9";
const CHASE = ["#ff8f7a", "#ffd27a", "#9fe6a0", "#8fd0ff", "#d4a6ff"];

// ---------------------------------------------------------------------------------------------
// The carousel

const CAROUSEL_SPIN = { rest: 0.35, boost: 2.1, seconds: 7 }; // radians per second
const HORSE_COUNT = 8;

function carouselBase(radius: number): BufferGeometry {
  const parts = partsBuilder();
  parts.add([
    cylinder(radius + 0.15, radius + 0.25, 0.3, 24, 0, 0.15, 0, CONCRETE),
    cylinder(radius + 0.32, radius + 0.32, 0.05, 24, 0, 0.32, 0, GOLD),
  ]);
  // A low white fence round it, open on the side facing the boardwalk.
  const fence = radius + 0.42;
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) < 0.3) continue;
    parts.add([box(0.08, 0.8, 0.08, Math.cos(a) * fence, 0.4, Math.sin(a) * fence, WHITE)]);
  }
  parts.add([
    paint(new TorusGeometry(fence, 0.05, 4, 40).rotateX(Math.PI / 2).translate(0, 0.78, 0), WHITE),
  ]);
  return parts.merge();
}

function carouselTop(radius: number, height: number): BufferGeometry {
  const parts = partsBuilder();
  const rim = radius + 0.3;
  const eave = height - 1.15;
  parts.add([
    cylinder(radius, radius, 0.14, 24, 0, 0.42, 0, WOOD),
    cylinder(0.62, 0.68, eave - 0.4, 12, 0, (eave + 0.4) / 2, 0, CREAM),
    cylinder(0.7, 0.7, 0.3, 12, 0, 1.2, 0, GOLD),
    cylinder(0.7, 0.7, 0.3, 12, 0, eave - 0.6, 0, GOLD),
    cylinder(rim, rim, 0.38, 24, 0, eave, 0, GOLD),
    paint(new SphereGeometry(0.28, 10, 8).translate(0, height + 0.05, 0), GOLD),
    triangle([0, height + 0.9, 0], [0, height + 0.35, 0], [0.7, height + 0.62, 0], RED),
    cylinder(0.03, 0.03, 0.9, 4, 0, height + 0.55, 0, GOLD),
  ]);
  // The canopy: striped wedges up to a peak, with a scalloped valance under the rim.
  const wedges = 16;
  for (let k = 0; k < wedges; k++) {
    const a0 = (k / wedges) * Math.PI * 2;
    const a1 = ((k + 1) / wedges) * Math.PI * 2;
    const colour = k % 2 === 0 ? RED : CREAM;
    parts.add([
      triangle(
        [0, height, 0],
        [Math.cos(a1) * rim, eave + 0.18, Math.sin(a1) * rim],
        [Math.cos(a0) * rim, eave + 0.18, Math.sin(a0) * rim],
        colour,
      ),
      triangle(
        [Math.cos(a0) * rim, eave - 0.19, Math.sin(a0) * rim],
        [Math.cos((a0 + a1) / 2) * rim, eave - 0.55, Math.sin((a0 + a1) / 2) * rim],
        [Math.cos(a1) * rim, eave - 0.19, Math.sin(a1) * rim],
        colour,
      ),
    ]);
  }
  // Brass poles for the horses.
  for (let k = 0; k < HORSE_COUNT; k++) {
    const a = (k / HORSE_COUNT) * Math.PI * 2;
    const r = radius * 0.72;
    parts.add([
      cylinder(0.04, 0.04, eave - 0.5, 6, Math.cos(a) * r, (eave + 0.5) / 2, Math.sin(a) * r, GOLD),
    ]);
  }
  return parts.merge();
}

// A carousel horse, facing +z: body, neck and head, legs out front and back, saddle and tail.
function horseGeometry(colour: string): BufferGeometry {
  const parts = partsBuilder();
  parts.add([
    box(0.34, 0.38, 0.95, 0, 0, 0, colour),
    paint(box(0.24, 0.5, 0.26, 0, 0, 0, colour).rotateX(0.5).translate(0, 0.3, 0.45), colour),
    box(0.22, 0.24, 0.42, 0, 0.55, 0.6, colour),
    box(0.36, 0.08, 0.4, 0, 0.22, -0.05, RED),
    paint(box(0.1, 0.5, 0.1, 0, 0, 0, colour).rotateX(-0.8).translate(0.1, -0.3, 0.45), colour),
    paint(box(0.1, 0.5, 0.1, 0, 0, 0, colour).rotateX(0.8).translate(-0.1, -0.3, -0.45), colour),
    paint(box(0.08, 0.42, 0.08, 0, 0, 0, GOLD).rotateX(0.5).translate(0, -0.05, -0.6), GOLD),
  ]);
  return parts.merge();
}

/** The carousel on the green: its horses rise and fall as it turns. Clicked, it whirls. */
function Carousel({ harbour, still }: { harbour: HarbourLayout; still: boolean }) {
  const { carousel } = harbour;
  const toy = useToy(CAROUSEL_SPIN.seconds, !still);
  const base = useMemo(() => carouselBase(carousel.radius), [carousel.radius]);
  const top = useMemo(
    () => carouselTop(carousel.radius, carousel.height),
    [carousel.radius, carousel.height],
  );
  const horses = useMemo(() => HORSES.slice(0, HORSE_COUNT).map(horseGeometry), []);
  const bulb = useMemo(() => new IcosahedronGeometry(0.09, 0), []);
  useEffect(
    () => () => [base, top, bulb, ...horses].forEach((g) => g.dispose()),
    [base, top, bulb, horses],
  );
  const spin = useRef<Group>(null);
  const riders = useRef<Group[]>([]);
  const angle = useRef(0);

  const bulbs = useRef<InstancedMesh>(null);
  const rim = carousel.radius + 0.3;
  useLayoutEffect(() => {
    const m = bulbs.current;
    if (!m) return;
    const matrix = new Matrix4();
    const at = new Vector3();
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      m.setMatrixAt(
        k,
        matrix.makeTranslation(
          at.set(Math.cos(a) * (rim + 0.02), carousel.height - 1.15, Math.sin(a) * (rim + 0.02)),
        ),
      );
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [rim, carousel.height]);

  useFrame(({ clock }, delta) => {
    if (still) return;
    const boost = toy.boost(clock.elapsedTime);
    angle.current += (CAROUSEL_SPIN.rest + CAROUSEL_SPIN.boost * boost) * Math.min(delta, 0.1);
    if (spin.current) spin.current.rotation.y = angle.current;
    riders.current.forEach((g, k) => {
      if (g) g.position.y = 1.35 + 0.28 * Math.sin(angle.current * 3 + (k * Math.PI) / 2);
    });
  });

  return (
    <group position={[carousel.x, 0, carousel.z]} {...toy.handlers}>
      <mesh geometry={base} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <group ref={spin}>
        <mesh geometry={top} castShadow receiveShadow>
          <meshLambertMaterial vertexColors side={2} />
        </mesh>
        {horses.map((g, k) => {
          const a = (k / HORSE_COUNT) * Math.PI * 2;
          const r = carousel.radius * 0.72;
          return (
            <group
              key={k}
              ref={(node) => {
                if (node) riders.current[k] = node;
              }}
              position={[Math.cos(a) * r, 1.35, Math.sin(a) * r]}
              // Riding round anticlockwise from above: facing along the turn.
              rotation-y={-a + Math.PI}
            >
              <mesh geometry={g} castShadow>
                <meshLambertMaterial vertexColors />
              </mesh>
            </group>
          );
        })}
        <instancedMesh ref={bulbs} args={[bulb, undefined, 32]}>
          <meshBasicMaterial color={BULB} />
        </instancedMesh>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// The ferris wheel

const WHEEL_SPIN = { rest: 0.07, boost: 0.75, seconds: 9 }; // radians per second
const LEG_SPREAD = 5; // each A-frame's feet stand this far either side of the hub
const FRAME_DEPTH = 1.15; // half the gap between the wheel's two rims
const SEAT_DROP = 0.95; // how far a gondola hangs below its pivot

function wheelStand(hub: number): BufferGeometry {
  const parts = partsBuilder();
  const leg = Math.hypot(LEG_SPREAD, hub);
  const lean = Math.atan2(LEG_SPREAD, hub);
  for (const z of [-FRAME_DEPTH - 0.35, FRAME_DEPTH + 0.35]) {
    for (const side of [-1, 1]) {
      parts.add([
        paint(
          box(0.38, leg, 0.38, 0, 0, 0, STEEL)
            .rotateZ(side * lean)
            .translate((side * LEG_SPREAD) / 2, hub / 2, z),
          STEEL,
        ),
      ]);
    }
    parts.add([box(LEG_SPREAD * 0.62, 0.22, 0.22, 0, hub * 0.38, z, STEEL)]);
  }
  parts.add([
    box(2 * LEG_SPREAD + 1.4, 0.4, 2 * FRAME_DEPTH + 2, 0, 0.2, 0, CONCRETE),
    paint(
      cylinder(0.32, 0.32, 2 * FRAME_DEPTH + 1.2, 12, 0, 0, 0, GOLD)
        .rotateX(Math.PI / 2)
        .translate(0, hub, 0),
      GOLD,
    ),
    // A ticket booth on the platform's near edge, clear of the legs and the gondolas.
    box(1.4, 2.0, 1.2, 3.6, 1.0, 2.6, RED),
    box(1.6, 0.18, 1.4, 3.6, 2.09, 2.6, WHITE),
  ]);
  return parts.merge();
}

function wheelRims(radius: number, gondolas: number): BufferGeometry {
  const parts = partsBuilder();
  for (const z of [-FRAME_DEPTH, FRAME_DEPTH]) {
    parts.add([
      paint(new TorusGeometry(radius, 0.13, 6, 72).translate(0, 0, z), STEEL),
      paint(new TorusGeometry(radius * 0.55, 0.09, 6, 48).translate(0, 0, z), STEEL),
      paint(new TorusGeometry(0.75, 0.16, 6, 16).translate(0, 0, z), GOLD),
    ]);
    for (let k = 0; k < gondolas; k++) {
      const a = (k / gondolas) * Math.PI * 2;
      parts.add([paint(box(0.08, radius, 0.08, 0, radius / 2, z, STEEL).rotateZ(a), STEEL)]);
    }
  }
  // Cross bars between the rims, one at each gondola's pivot.
  for (let k = 0; k < gondolas; k++) {
    const a = (k / gondolas) * Math.PI * 2;
    parts.add([
      paint(
        cylinder(0.07, 0.07, 2 * FRAME_DEPTH, 6, 0, 0, 0, STEEL)
          .rotateX(Math.PI / 2)
          .translate(Math.sin(a) * radius, -Math.cos(a) * radius, 0),
        STEEL,
      ),
    ]);
  }
  return parts.merge();
}

function gondolaGeometry(colour: string): BufferGeometry {
  const parts = partsBuilder();
  parts.add([
    box(0.08, SEAT_DROP - 0.35, 0.08, 0, -(SEAT_DROP - 0.35) / 2, 0, STEEL),
    box(1.25, 0.12, 1.45, 0, -SEAT_DROP + 0.62, 0, WHITE),
    box(1.15, 0.48, 1.3, 0, -SEAT_DROP - 0.1, 0, colour),
    box(1.0, 0.36, 1.18, 0, -SEAT_DROP + 0.32, 0, "#cfe4ee"),
    box(0.1, 0.62, 0.1, 0.55, -SEAT_DROP + 0.25, 0.62, WHITE),
    box(0.1, 0.62, 0.1, -0.55, -SEAT_DROP + 0.25, 0.62, WHITE),
    box(0.1, 0.62, 0.1, 0.55, -SEAT_DROP + 0.25, -0.62, WHITE),
    box(0.1, 0.62, 0.1, -0.55, -SEAT_DROP + 0.25, -0.62, WHITE),
  ]);
  return parts.merge();
}

/**
 * The ferris wheel at the end of the pier, turning slowly with its gondolas hanging level. Clicked,
 * it spins up and its lights chase round the rims.
 */
function FerrisWheel({ harbour, still }: { harbour: HarbourLayout; still: boolean }) {
  const { wheel } = harbour;
  const toy = useToy(WHEEL_SPIN.seconds, !still, 1.2);
  const stand = useMemo(() => wheelStand(wheel.hub), [wheel.hub]);
  const rims = useMemo(
    () => wheelRims(wheel.radius, wheel.gondolas),
    [wheel.radius, wheel.gondolas],
  );
  const cars = useMemo(() => GONDOLAS.map(gondolaGeometry), []);
  const bulb = useMemo(() => new IcosahedronGeometry(0.13, 0), []);
  useEffect(
    () => () => [stand, rims, bulb, ...cars].forEach((g) => g.dispose()),
    [stand, rims, bulb, cars],
  );
  const spin = useRef<Group>(null);
  const seats = useRef<Group[]>([]);
  const lights = useRef<InstancedMesh>(null);
  const angle = useRef(0);
  const colour = useMemo(() => new Color(), []);
  const lit = useRef(false);
  const bulbCount = wheel.gondolas * 4;

  useLayoutEffect(() => {
    const m = lights.current;
    if (!m) return;
    const matrix = new Matrix4();
    const at = new Vector3();
    for (let k = 0; k < bulbCount; k++) {
      const a = ((k >> 1) / (bulbCount / 2)) * Math.PI * 2 + Math.PI / wheel.gondolas;
      const z = k % 2 === 0 ? -FRAME_DEPTH - 0.12 : FRAME_DEPTH + 0.12;
      m.setMatrixAt(
        k,
        matrix.makeTranslation(at.set(Math.sin(a) * wheel.radius, -Math.cos(a) * wheel.radius, z)),
      );
      m.setColorAt(k, colour.set(BULB));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [bulbCount, wheel.radius, wheel.gondolas, colour]);

  useFrame(({ clock }, delta) => {
    if (still) return;
    const now = clock.elapsedTime;
    const boost = toy.boost(now);
    angle.current += (WHEEL_SPIN.rest + WHEEL_SPIN.boost * boost) * Math.min(delta, 0.1);
    const a = angle.current;
    if (spin.current) spin.current.rotation.z = a;
    seats.current.forEach((g, k) => {
      // Level as the wheel turns, swinging a little more the faster it goes.
      if (g) g.rotation.z = -a + Math.sin(now * 1.4 + k) * (0.03 + 0.12 * boost);
    });
    // Lights chase round while it's whirling, and settle back to warm white after.
    const m = lights.current;
    if (!m || !m.instanceColor) return;
    if (boost > 0) {
      for (let k = 0; k < bulbCount; k++) {
        const step = Math.floor(now * 8 - (k >> 1)) % CHASE.length;
        colour.set(CHASE[(step + CHASE.length) % CHASE.length]).lerp(BULB_COLOUR, 1 - boost);
        m.setColorAt(k, colour);
      }
      m.instanceColor.needsUpdate = true;
      lit.current = true;
    } else if (lit.current) {
      for (let k = 0; k < bulbCount; k++) m.setColorAt(k, BULB_COLOUR);
      m.instanceColor.needsUpdate = true;
      lit.current = false;
    }
  });

  return (
    <group position={[wheel.x, 0, wheel.z]} {...toy.handlers}>
      <mesh geometry={stand} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <group position-y={wheel.hub}>
        <group ref={spin}>
          <mesh geometry={rims} castShadow>
            <meshLambertMaterial vertexColors />
          </mesh>
          <instancedMesh ref={lights} args={[bulb, undefined, bulbCount]}>
            <meshBasicMaterial />
          </instancedMesh>
          {Array.from({ length: wheel.gondolas }, (_, k) => {
            const a = (k / wheel.gondolas) * Math.PI * 2;
            return (
              <group
                key={k}
                ref={(node) => {
                  if (node) seats.current[k] = node;
                }}
                position={[Math.sin(a) * wheel.radius, -Math.cos(a) * wheel.radius, 0]}
              >
                <mesh geometry={cars[k % cars.length]} castShadow>
                  <meshLambertMaterial vertexColors />
                </mesh>
              </group>
            );
          })}
        </group>
      </group>
    </group>
  );
}

const BULB_COLOUR = new Color(BULB);

/** The festival's two rides: the carousel on the green and the ferris wheel off the pier head. */
export function HarbourRides({ harbour }: { harbour: HarbourLayout }) {
  const still = useReducedMotion();
  return (
    <group>
      <Carousel harbour={harbour} still={still} />
      <FerrisWheel harbour={harbour} still={still} />
    </group>
  );
}

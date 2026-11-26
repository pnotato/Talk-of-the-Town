import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  type BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { useReducedMotion } from "./blobMedia.ts";
import { box, cylinder, gable, paint, partsBuilder } from "./harbourGeometry.ts";
import { type Startle, useToy } from "./harbourToys.ts";
import { type HarbourLayout, WATER_LEVEL } from "./layoutHarbour.ts";

const WHITE = "#f7f3ea";
const RED = "#c8463d";
const IRON = "#2f3b36";
const PANE = "#3f4f60";
const LAMP = "#fff2b8";
const GLASS = "#fdf6d8";

const ISLAND_TOP = 0.5; // the rock's grass, where the tower stands
const BANDS = 5;
const GALLERY = 0.8; // below the lantern, from the top of the tower
const BEAM = { length: 30, radius: 2.8, opacity: 0.16 };
const SPIN = { rest: 0.55, boost: 4.5, seconds: 6 }; // radians per second
const HORN = { rings: 3, spread: 22, seconds: 3.6 };

function towerGeometry(radius: number, height: number): BufferGeometry {
  const parts = partsBuilder();
  const shaft = height - 3.2; // the tower proper; the lantern and cap stand on it
  const top = radius * 0.7;
  for (let k = 0; k < BANDS; k++) {
    const y0 = (shaft * k) / BANDS;
    const y1 = (shaft * (k + 1)) / BANDS;
    const r0 = radius + (top - radius) * (k / BANDS);
    const r1 = radius + (top - radius) * ((k + 1) / BANDS);
    parts.add([cylinder(r1, r0, y1 - y0, 16, 0, (y0 + y1) / 2, 0, k % 2 === 0 ? WHITE : RED)]);
  }
  const gallery = shaft;
  parts.add([
    cylinder(top + 0.45, top + 0.3, 0.28, 16, 0, gallery + 0.14, 0, IRON),
    paint(
      new TorusGeometry(top + 0.42, 0.04, 4, 32)
        .rotateX(Math.PI / 2)
        .translate(0, gallery + 0.95, 0),
      IRON,
    ),
    cylinder(top * 0.8, top * 0.85, 0.35, 12, 0, gallery + 0.45, 0, WHITE),
    // The cap over the lantern, its vent and vane.
    paint(
      new ConeGeometry(top * 0.95, 1.2, 12).translate(0, gallery + GALLERY + 1.55 + 0.6, 0),
      RED,
    ),
    paint(new SphereGeometry(0.16, 8, 6).translate(0, gallery + GALLERY + 2.85, 0), IRON),
    cylinder(0.03, 0.03, 0.8, 4, 0, gallery + GALLERY + 3.2, 0, IRON),
    // A door facing the bay and windows up the tower.
    box(0.7, 1.3, 0.12, 0, 0.65, radius - 0.02, IRON),
  ]);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    parts.add([
      box(
        0.04,
        0.8,
        0.04,
        Math.cos(a) * (top + 0.42),
        gallery + 0.55,
        Math.sin(a) * (top + 0.42),
        IRON,
      ),
    ]);
  }
  for (let k = 1; k < 4; k++) {
    const y = (shaft * (k + 0.5)) / 4;
    const r = radius + (top - radius) * (y / shaft);
    parts.add([box(0.32, 0.5, 0.1, 0, y, r - 0.01, PANE)]);
  }
  // Glazing bars round the lantern.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = top * 0.82;
    parts.add([
      box(0.05, 1.5, 0.05, Math.cos(a) * r, gallery + GALLERY + 0.75, Math.sin(a) * r, IRON),
    ]);
  }
  return parts.merge();
}

function cottageGeometry(): BufferGeometry {
  const parts = partsBuilder();
  parts.add([
    box(3.2, 2.1, 2.6, 0, 1.05, 0, WHITE),
    gable(3.4, 3.0, 1.4, RED, WHITE).translate(0, 2.1, 0),
    box(0.7, 1.3, 0.08, 0.6, 0.65, 1.32, RED),
    box(0.6, 0.6, 0.08, -0.8, 1.2, 1.32, PANE),
    box(0.4, 1.0, 0.4, -1.0, 3.0, 0, "#8d5a4a"),
  ]);
  return parts.merge();
}

/**
 * The lighthouse on its rock at the end of the breakwater, its beam sweeping round over the bay,
 * with the keeper's cottage beside it. Clicked, the lamp flares, the beam whirls and the horn
 * sounds: rings spread over the water, and the gulls scatter.
 */
export function HarbourLighthouse({
  harbour,
  startleRef,
}: {
  harbour: HarbourLayout;
  startleRef: Startle;
}) {
  const still = useReducedMotion();
  const { lighthouse } = harbour;
  const toy = useToy(SPIN.seconds, !still, 0.3);
  const tower = useMemo(() => towerGeometry(lighthouse.radius, lighthouse.height), [lighthouse]);
  const cottage = useMemo(() => cottageGeometry(), []);
  // Each beam's apex at the lamp, opening outwards along +x and fading to nothing at its far end;
  // the other is turned half round.
  const beam = useMemo(() => {
    const g = new ConeGeometry(BEAM.radius, BEAM.length, 24, 8, true).translate(
      0,
      -BEAM.length / 2,
      0,
    );
    const position = g.getAttribute("position");
    const fade = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const t = -position.getY(i) / BEAM.length;
      fade.set([1, 1, 1, (1 - t) ** 1.5], i * 4);
    }
    g.setAttribute("color", new Float32BufferAttribute(fade, 4));
    return g.rotateZ(Math.PI / 2);
  }, []);
  useEffect(() => () => [tower, cottage, beam].forEach((g) => g.dispose()), [tower, cottage, beam]);
  const lampY = lighthouse.height - 3.2 + GALLERY + 0.75;
  const sweep = useRef<Group>(null);
  const lamp = useRef<MeshBasicMaterial>(null);
  const beams = useRef<MeshBasicMaterial[]>([]);
  const rings = useRef<Mesh[]>([]);
  const angle = useRef(0);

  useFrame(({ clock }, delta) => {
    const now = clock.elapsedTime;
    const boost = toy.boost(now);
    const since = toy.since(now);
    if (since < 0.1) startleRef.current = Math.max(startleRef.current, now - since);
    if (!still) angle.current += (SPIN.rest + SPIN.boost * boost) * Math.min(delta, 0.1);
    if (sweep.current) sweep.current.rotation.y = angle.current;
    const flare = 1 + 1.2 * boost;
    for (const m of beams.current) if (m) m.opacity = BEAM.opacity * flare;
    if (lamp.current) lamp.current.color.setRGB(1, 0.95, 0.72).multiplyScalar(0.9 + 0.35 * boost);
    rings.current.forEach((ring, k) => {
      if (!ring) return;
      const age = since - k * 0.45;
      ring.visible = age > 0 && age < HORN.seconds;
      if (!ring.visible) return;
      const t = age / HORN.seconds;
      const r = harbour.lighthouse.island + t * HORN.spread;
      ring.scale.set(r, r, r);
      (ring.material as MeshBasicMaterial).opacity = 0.5 * (1 - t) * (1 - t);
    });
  });

  return (
    <group position={[lighthouse.x, 0, lighthouse.z]}>
      <group {...toy.handlers}>
        <mesh geometry={tower} position-y={ISLAND_TOP} castShadow receiveShadow>
          <meshLambertMaterial vertexColors />
        </mesh>
        <mesh position-y={lampY + ISLAND_TOP}>
          <cylinderGeometry args={[lighthouse.radius * 0.55, lighthouse.radius * 0.55, 1.4, 12]} />
          <meshBasicMaterial ref={lamp} color={LAMP} />
        </mesh>
        <mesh position-y={lampY + ISLAND_TOP}>
          <cylinderGeometry
            args={[lighthouse.radius * 0.6, lighthouse.radius * 0.6, 1.45, 12, 1, true]}
          />
          <meshBasicMaterial color={GLASS} transparent opacity={0.35} depthWrite={false} />
        </mesh>
        {/* Easy to hit: the whole tower. */}
        <mesh
          visible={false}
          position-y={lighthouse.height / 2}
          scale={[3.4, lighthouse.height + 1, 3.4]}
        >
          <boxGeometry />
        </mesh>
      </group>
      <mesh
        geometry={cottage}
        position={[2.9, ISLAND_TOP, 1.4]}
        rotation-y={-0.5}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial vertexColors />
      </mesh>
      <group ref={sweep} position-y={lampY + ISLAND_TOP}>
        {[0, Math.PI].map((turn, k) => (
          <mesh key={k} geometry={beam} rotation-y={turn} renderOrder={2}>
            <meshBasicMaterial
              ref={(m) => {
                if (m) beams.current[k] = m;
              }}
              color={LAMP}
              vertexColors
              transparent
              opacity={BEAM.opacity}
              depthWrite={false}
              blending={AdditiveBlending}
              side={2}
            />
          </mesh>
        ))}
      </group>
      {Array.from({ length: HORN.rings }, (_, k) => (
        <mesh
          key={k}
          ref={(m) => {
            if (m) rings.current[k] = m;
          }}
          position-y={WATER_LEVEL + 0.12}
          rotation-x={-Math.PI / 2}
          visible={false}
          renderOrder={1}
        >
          <ringGeometry args={[0.96, 1, 64]} />
          <meshBasicMaterial color="#ffffff" transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

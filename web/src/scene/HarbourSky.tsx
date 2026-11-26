import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  type BufferGeometry,
  Color,
  type Group,
  IcosahedronGeometry,
  ShaderMaterial,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useReducedMotion } from "./blobMedia.ts";
import { box, paint, partsBuilder, triangle } from "./harbourGeometry.ts";
import { toyBoost } from "./harbourMotion.ts";
import type { Startle } from "./harbourToys.ts";
import { seededRandom } from "./mapLayout.ts";

const DOME_RADIUS = 4500;
const CLOUD = "#fbfaf6";
const GULL = "#f7f6f2";
const WING_TIP = "#3a3f46";
const BEAK = "#e8b23c";

/** Sky colours: the fog and the far water melt into the horizon; it deepens overhead. */
export interface SkyColours {
  horizon: string;
  zenith: string;
  /** A soft glow round the sun, low in the south-west behind the default view. */
  glow: string;
}

function domeMaterial({ horizon, zenith, glow }: SkyColours): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      horizon: { value: new Color(horizon) },
      zenith: { value: new Color(zenith) },
      glow: { value: new Color(glow) },
      sun: { value: [-0.55, 0.35, 0.6] },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 glow;
      uniform vec3 sun;
      varying vec3 vDirection;
      void main() {
        float up = clamp(vDirection.y, 0.0, 1.0);
        vec3 colour = mix(horizon, zenith, smoothstep(0.0, 0.42, up));
        float toSun = max(dot(normalize(vDirection), normalize(sun)), 0.0);
        colour = mix(colour, glow, pow(toSun, 6.0) * 0.55 * (1.0 - up));
        gl_FragColor = vec4(colour, 1.0);
      }
    `,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
}

// Fair-weather cumulus far out over the lake, drifting east.
const CLOUDS = 7;
const DRIFT = 1.6; // units a second
const CLOUD_SPAN = 760; // they wrap round across this width

function cloudGeometry(seed: number): BufferGeometry {
  const random = seededRandom(seed);
  const puffs: BufferGeometry[] = [];
  const count = 5 + Math.floor(random() * 4);
  for (let k = 0; k < count; k++) {
    const r = 5 + random() * 6;
    puffs.push(
      new IcosahedronGeometry(r, 1)
        .scale(1, 0.62, 0.85)
        .translate(
          (k - count / 2) * 6 + random() * 3,
          r * 0.3 + random() * 2,
          (random() - 0.5) * 8,
        ),
    );
  }
  const merged = mergeGeometries(puffs);
  for (const p of puffs) p.dispose();
  return merged;
}

function Clouds({ still }: { still: boolean }) {
  const clouds = useMemo(() => {
    const random = seededRandom(0xc10d);
    return Array.from({ length: CLOUDS }, (_, k) => ({
      geometry: cloudGeometry(k + 11),
      x: -CLOUD_SPAN / 2 + (CLOUD_SPAN * (k + random() * 0.6)) / CLOUDS,
      y: 48 + random() * 30,
      z: -230 - random() * 220,
      scale: 1 + random() * 0.8,
    }));
  }, []);
  useEffect(() => () => clouds.forEach((c) => c.geometry.dispose()), [clouds]);
  const groups = useRef<Group[]>([]);
  useFrame(({ clock }) => {
    if (still) return;
    clouds.forEach((c, k) => {
      const g = groups.current[k];
      if (!g) return;
      const x = c.x + clock.elapsedTime * DRIFT + CLOUD_SPAN / 2;
      g.position.x = (((x % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - CLOUD_SPAN / 2;
    });
  });
  return (
    <group>
      {clouds.map((c, k) => (
        <group
          key={k}
          ref={(g) => {
            if (g) groups.current[k] = g;
          }}
          position={[c.x, c.y, c.z]}
          scale={c.scale}
        >
          <mesh geometry={c.geometry}>
            <meshLambertMaterial
              color={CLOUD}
              flatShading
              emissive={CLOUD}
              emissiveIntensity={0.35}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Herring gulls wheeling over the bay.
const GULLS = [
  { x: -6, z: -24, radius: 14, height: 15, speed: 0.32 },
  { x: -6, z: -24, radius: 10, height: 17, speed: 0.38 },
  { x: -30, z: -40, radius: 12, height: 13, speed: -0.3 },
  { x: -30, z: -40, radius: 16, height: 16, speed: -0.26 },
  { x: 24, z: -34, radius: 11, height: 14, speed: 0.35 },
  { x: 24, z: -34, radius: 15, height: 18, speed: 0.29 },
  { x: 40, z: -12, radius: 9, height: 12, speed: -0.4 },
  { x: 4, z: -6, radius: 18, height: 19, speed: 0.24 },
];
const SCATTER = { seconds: 7, wider: 0.9, higher: 9, faster: 1.6 };

function gullGeometry(): { body: BufferGeometry; wing: BufferGeometry } {
  const body = partsBuilder();
  body.add([
    box(0.18, 0.16, 0.7, 0, 0, 0, GULL),
    box(0.14, 0.14, 0.2, 0, 0.04, 0.42, GULL),
    paint(box(0.05, 0.05, 0.16, 0, 0.02, 0.56, BEAK), BEAK),
    triangle([0, 0, -0.32], [-0.14, 0, -0.55], [0.14, 0, -0.55], GULL),
  ]);
  // One wing along +x from the shoulder, its tip dark; the other is the same, mirrored.
  const wing = partsBuilder();
  wing.add([
    triangle([0, 0, 0.18], [0, 0, -0.16], [0.62, 0, -0.05], GULL),
    triangle([0.62, 0, -0.05], [0.6, 0, 0.14], [0, 0, 0.18], GULL),
    triangle([0.62, 0, -0.05], [1.0, 0, -0.18], [0.6, 0, 0.14], WING_TIP),
  ]);
  return { body: body.merge(), wing: wing.merge() };
}

/** Gulls wheeling over the bay. A firework or the lighthouse's horn scatters them. */
function Gulls({ startleRef, still }: { startleRef: Startle; still: boolean }) {
  const geometry = useMemo(() => gullGeometry(), []);
  useEffect(() => () => [geometry.body, geometry.wing].forEach((g) => g.dispose()), [geometry]);
  const birds = useRef<Group[]>([]);
  const wings = useRef<Group[]>([]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const t = still ? 0 : now;
    const scare = toyBoost(now - startleRef.current, SCATTER.seconds, 0.4);
    GULLS.forEach((g, k) => {
      const bird = birds.current[k];
      if (!bird) return;
      const radius = g.radius * (1 + SCATTER.wider * scare);
      const a = t * g.speed * (1 + SCATTER.faster * scare) + k * 1.3;
      bird.position.set(
        g.x + Math.sin(a) * radius,
        g.height + SCATTER.higher * scare + Math.sin(t * 0.7 + k) * 0.8,
        g.z + Math.cos(a) * radius,
      );
      // Flying along the circle, banked into the turn.
      const dir = Math.sign(g.speed);
      bird.rotation.set(0, a + (dir * Math.PI) / 2, -dir * 0.35, "YXZ");
      const flap = Math.sin(t * (4 + 6 * scare) + k * 2.1) * (0.3 + 0.35 * scare) + 0.1;
      const left = wings.current[2 * k];
      const right = wings.current[2 * k + 1];
      if (left) left.rotation.z = flap;
      if (right) right.rotation.z = -flap;
    });
  });

  return (
    <group>
      {GULLS.map((_, k) => (
        <group
          key={k}
          ref={(g) => {
            if (g) birds.current[k] = g;
          }}
        >
          <mesh geometry={geometry.body} castShadow>
            <meshLambertMaterial vertexColors side={2} />
          </mesh>
          {[1, -1].map((side, s) => (
            <group
              key={side}
              ref={(g) => {
                if (g) wings.current[2 * k + s] = g;
              }}
              scale={[side, 1, 1]}
            >
              <mesh geometry={geometry.wing}>
                <meshLambertMaterial vertexColors side={2} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/** The sky over the lake: a soft dome melting into the fog at the horizon, clouds and gulls. */
export function HarbourSky({ colours, startleRef }: { colours: SkyColours; startleRef: Startle }) {
  const still = useReducedMotion();
  const dome = useMemo(() => new SphereGeometry(DOME_RADIUS, 32, 16), []);
  const material = useMemo(() => domeMaterial(colours), [colours]);
  useEffect(() => () => [dome, material].forEach((r) => r.dispose()), [dome, material]);
  return (
    <group>
      <mesh geometry={dome} material={material} renderOrder={-1} frustumCulled={false} />
      <Clouds still={still} />
      <Gulls startleRef={startleRef} still={still} />
    </group>
  );
}

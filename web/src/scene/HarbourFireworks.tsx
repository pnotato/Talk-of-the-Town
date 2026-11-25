import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  type Mesh,
  type MeshBasicMaterial,
  type PointLight,
} from "three";
import {
  FIREWORK,
  FIREWORK_COLOURS,
  FIREWORK_LIFE,
  type FireworkQueue,
  MAX_FIREWORKS,
  type Spark,
  sparkAt,
} from "./harbourMotion.ts";
import { WATER_LEVEL } from "./layoutHarbour.ts";

const RIPPLE = { seconds: 2.2, spread: 7 };
// A burst's first instant: a big soft glow at its heart, gone in a blink.
const BLOOM = { seconds: 0.45, size: 11 };
// The burst's light on the water and the boats: candela at its brightest, and its reach.
const FLASH = { intensity: 900, distance: 80, seconds: 0.7 };

// The spark being drawn, reused so a frame allocates nothing.
const spark: Spark = { x: 0, y: 0, z: 0, glow: 0 };

// A soft round spark: white in the middle, fading to nothing at the edge.
function sparkTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (g) {
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.75)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

/**
 * Fireworks over the bay, launched by clicking the water (`queue`): a rocket climbs from the
 * click, bursts into a sphere of sparks that droop and fade, lights up the water and the boats
 * for a moment, and leaves a ripple where it left the water. Allocates nothing per frame.
 */
export function HarbourFireworks({ queue }: { queue: FireworkQueue }) {
  const count = MAX_FIREWORKS * FIREWORK.sparks;
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
    // Colour and alpha: in daylight the sparks fade out rather than darken.
    g.setAttribute("color", new Float32BufferAttribute(new Float32Array(count * 4), 4));
    return g;
  }, [count]);
  const blooms = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(MAX_FIREWORKS * 3), 3));
    g.setAttribute("color", new Float32BufferAttribute(new Float32Array(MAX_FIREWORKS * 4), 4));
    return g;
  }, []);
  const texture = useMemo(() => sparkTexture(), []);
  useEffect(
    () => () => [geometry, blooms, texture].forEach((r) => r.dispose()),
    [geometry, blooms, texture],
  );
  // Whether last frame drew anything, so an idle sky uploads nothing.
  const wasLive = useRef(false);
  const palette = useMemo(() => FIREWORK_COLOURS.map((c) => new Color(c)), []);
  const flash = useRef<PointLight>(null);
  const ripples = useRef<Mesh[]>([]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const position = geometry.getAttribute("position");
    const colour = geometry.getAttribute("color");
    const bloomAt = blooms.getAttribute("position");
    const bloomColour = blooms.getAttribute("color");
    let brightest = 0;
    let any = false;
    for (let f = 0; f < MAX_FIREWORKS; f++) {
      const age = now - queue.times[f];
      const live = age >= 0 && age < FIREWORK_LIFE;
      const base = f * FIREWORK.sparks;
      const c = palette[queue.colours[f] % palette.length];
      for (let i = 0; i < FIREWORK.sparks; i++) {
        if (live) sparkAt(i, age, queue.heights[f], queue.seeds[f], spark);
        else spark.glow = 0;
        const k = base + i;
        if (spark.glow > 0) {
          any = true;
          position.setXYZ(k, queue.xs[f] + spark.x, WATER_LEVEL + spark.y, queue.zs[f] + spark.z);
          // The rocket climbs warm white; the burst is its colour, white-hot for a moment.
          const hot = age < FIREWORK.rise ? 0.85 : Math.max(0, 1 - (age - FIREWORK.rise) * 5);
          colour.setXYZW(
            k,
            c.r + (1 - c.r) * hot,
            c.g + (1 - c.g) * hot,
            c.b + (1 - c.b) * hot,
            Math.min(1, spark.glow * 1.6),
          );
        } else {
          colour.setW(k, 0);
        }
      }
      // The freshest burst lights the scene, and each blooms for a moment as it bursts.
      const burst = age - FIREWORK.rise;
      const bloom = burst >= 0 && burst < BLOOM.seconds ? (1 - burst / BLOOM.seconds) ** 2 : 0;
      bloomAt.setXYZ(f, queue.xs[f], WATER_LEVEL + queue.heights[f], queue.zs[f]);
      bloomColour.setXYZW(f, (c.r + 2) / 3, (c.g + 2) / 3, (c.b + 2) / 3, bloom);
      if (burst >= 0 && burst < FLASH.seconds) {
        const strength = (1 - burst / FLASH.seconds) ** 2;
        if (strength > brightest && flash.current) {
          brightest = strength;
          flash.current.position.set(queue.xs[f], WATER_LEVEL + queue.heights[f], queue.zs[f]);
          flash.current.color.copy(c);
        }
      }
      const ripple = ripples.current[f];
      if (ripple) {
        ripple.visible = age >= 0 && age < RIPPLE.seconds;
        if (ripple.visible) {
          const t = age / RIPPLE.seconds;
          const r = 0.3 + t * RIPPLE.spread;
          ripple.position.set(queue.xs[f], WATER_LEVEL + 0.14, queue.zs[f]);
          ripple.scale.set(r, r, r);
          (ripple.material as MeshBasicMaterial).opacity = 0.7 * (1 - t);
        }
      }
    }
    if (flash.current) flash.current.intensity = FLASH.intensity * brightest;
    if (any || wasLive.current) {
      position.needsUpdate = true;
      colour.needsUpdate = true;
      bloomAt.needsUpdate = true;
      bloomColour.needsUpdate = true;
    }
    wasLive.current = any;
  });

  return (
    <group>
      <points geometry={geometry} frustumCulled={false} renderOrder={3}>
        <pointsMaterial
          size={2.3}
          map={texture}
          vertexColors
          transparent
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      <points geometry={blooms} frustumCulled={false} renderOrder={3}>
        <pointsMaterial
          size={BLOOM.size}
          map={texture}
          vertexColors
          transparent
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      {/* Always present, so lighting never recompiles; dark until a burst. */}
      <pointLight ref={flash} intensity={0} distance={FLASH.distance} decay={2} />
      {Array.from({ length: MAX_FIREWORKS }, (_, f) => (
        <mesh
          key={f}
          ref={(m) => {
            if (m) ripples.current[f] = m;
          }}
          rotation-x={-Math.PI / 2}
          visible={false}
          renderOrder={1}
        >
          <ringGeometry args={[0.85, 1, 48]} />
          <meshBasicMaterial color="#ffffff" transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

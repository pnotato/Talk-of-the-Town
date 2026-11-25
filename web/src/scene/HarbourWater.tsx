import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type MeshBasicMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
} from "three";
import { useReducedMotion } from "./blobMedia.ts";
import { gestureFor } from "./blobPicking.ts";
import { harbourShores, shoreCalm, shoreDistance, smoothstep, waveGlsl } from "./harbourMotion.ts";
import { type HarbourLayout, WATER_LEVEL } from "./layoutHarbour.ts";
import { type Point } from "./mapLayout.ts";
import { GROUND_RADIUS } from "./TownGround.tsx";

// Shallows over the rocks, through the bay, to the deep water beyond: soft, a little green near
// the shore, so the blobs' mood colours stay the brightest things in view.
const SHALLOW = new Color("#9fd2c7");
const BAY = new Color("#72b1c2");
export const DEEP = "#538fb2";
const DEEP_COLOR = new Color(DEEP);
const SPECULAR = new Color("#5d7580");

// The waving water: a grid of this cell size over this patch; past it the sea is a flat disc.
const WATER = { minX: -264, maxX: 264, minZ: -264, maxZ: 13.2, cell: 2.2 };
// Waves die away over this distance before the patch's edge, so it meets the flat sea exactly.
const EDGE_FADE = 50;
const FAR_DROP = 0.35; // the flat sea sits this far below still water, under the patch
const FOAM = { inner: -0.15, outer: 1.1, lift: 0.06 };

// The patch of waving water: coloured by depth, with how much each vertex may move ("calm").
function buildWater(harbour: HarbourLayout): BufferGeometry {
  const { minX, maxX, minZ, maxZ, cell } = WATER;
  const geometry = new PlaneGeometry(
    maxX - minX,
    maxZ - minZ,
    Math.round((maxX - minX) / cell),
    Math.round((maxZ - minZ) / cell),
  )
    .rotateX(-Math.PI / 2)
    .translate((minX + maxX) / 2, WATER_LEVEL, (minZ + maxZ) / 2);
  geometry.deleteAttribute("uv");
  const shores = harbourShores(harbour);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const calm = new Float32Array(position.count);
  const c = new Color();
  const p = { x: 0, z: 0 };
  for (let i = 0; i < position.count; i++) {
    p.x = position.getX(i);
    p.z = position.getZ(i);
    const d = shoreDistance(p, shores);
    c.copy(SHALLOW)
      .lerp(BAY, smoothstep(0, 9, d))
      .lerp(DEEP_COLOR, smoothstep(6, 34, d));
    colors.set([c.r, c.g, c.b], i * 3);
    const edge = Math.min(p.x - minX, maxX - p.x, p.z - minZ, maxZ - p.z);
    calm[i] = smoothstep(0, EDGE_FADE, edge) * shoreCalm(d);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("calm", new Float32BufferAttribute(calm, 1));
  return geometry;
}

// A band of foam out from a run of shore: opaque at the waterline, fading out to sea. `normals`
// point out to sea, one per point.
function band(points: Point[], normals: Point[], positions: number[], colors: number[]) {
  const y = WATER_LEVEL + FOAM.lift;
  for (let i = 1; i < points.length; i++) {
    const quad = [i - 1, i];
    const inner = quad.map((k) => [
      points[k].x + normals[k].x * FOAM.inner,
      y,
      points[k].z + normals[k].z * FOAM.inner,
    ]);
    const outer = quad.map((k) => [
      points[k].x + normals[k].x * FOAM.outer,
      y,
      points[k].z + normals[k].z * FOAM.outer,
    ]);
    // Two triangles facing up: inner0, outer1, outer0 and inner0, inner1, outer1.
    for (const [v, alpha] of [
      [inner[0], 0.9],
      [outer[1], 0],
      [outer[0], 0],
      [inner[0], 0.9],
      [inner[1], 0.9],
      [outer[1], 0],
    ] as [number[], number][]) {
      positions.push(...v);
      colors.push(1, 1, 1, alpha);
    }
  }
}

// Out-to-sea normals along an open run whose water lies to its left (walking from first to last).
function leftNormals(points: Point[]): Point[] {
  return points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: dz / length, z: -dx / length };
  });
}

function circle(x: number, z: number, radius: number, segments: number): Point[] {
  return Array.from({ length: segments + 1 }, (_, k) => {
    const a = (k / segments) * Math.PI * 2;
    return { x: x + Math.cos(a) * radius, z: z + Math.sin(a) * radius };
  });
}

/** Foam along the shore in view, round the lighthouse's rock and down both sides of the breakwater. */
function buildFoam(harbour: HarbourLayout): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  // The coast runs west to east with the water to its north, which is its left.
  const shore = harbour.coast.filter((p) => Math.abs(p.x) < 170);
  band(shore, leftNormals(shore), positions, colors);
  const { lighthouse, breakwater } = harbour;
  const ring = circle(lighthouse.x, lighthouse.z, lighthouse.island - 0.2, 40);
  band(
    ring,
    ring.map((p) => {
      const d = Math.hypot(p.x - lighthouse.x, p.z - lighthouse.z);
      return { x: (p.x - lighthouse.x) / d, z: (p.z - lighthouse.z) / d };
    }),
    positions,
    colors,
  );
  const { from, to, width } = breakwater;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const side = { x: (to.z - from.z) / length, z: -(to.x - from.x) / length };
  for (const s of [-1, 1]) {
    const offset = (width / 2 + 0.2) * s;
    const run = [from, to].map((p) => ({ x: p.x + side.x * offset, z: p.z + side.z * offset }));
    const normal = { x: side.x * s, z: side.z * s };
    band(run, [normal, normal], positions, colors);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
  return geometry;
}

/**
 * The bay: low-poly water whose facets rise and fall with the swell (waveHeight, run on the GPU)
 * and catch the sun, shading from pale shallows over the rocks to deep water out past the pier,
 * with foam lapping at the shore. Past the patch the flat sea runs to the horizon. Clicking the
 * water launches a firework from that spot.
 */
export function HarbourWater({
  harbour,
  onLaunch,
}: {
  harbour: HarbourLayout;
  /** Called with where on the water the player clicked. */
  onLaunch?: (x: number, z: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const canvas = useThree((s) => s.gl.domElement);
  const water = useMemo(() => buildWater(harbour), [harbour]);
  const foam = useMemo(() => buildFoam(harbour), [harbour]);
  const time = useRef({ value: 0 });
  const material = useMemo(() => {
    const m = new MeshPhongMaterial({
      vertexColors: true,
      flatShading: true,
      shininess: 70,
      specular: SPECULAR,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time.current;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\nuniform float uTime;\nattribute float calm;\n${waveGlsl()}`,
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\ntransformed.y += calm * waveHeight(transformed.xz, uTime);",
        );
    };
    m.customProgramCacheKey = () => "harbour-water";
    return m;
  }, []);
  useEffect(
    () => () => {
      water.dispose();
      foam.dispose();
      material.dispose();
    },
    [water, foam, material],
  );

  const foamMaterial = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    // Reduced motion: a still bay.
    if (reduceMotion) return;
    time.current.value = clock.elapsedTime;
    if (foamMaterial.current) {
      foamMaterial.current.opacity = 0.7 + 0.22 * Math.sin(clock.elapsedTime * 0.8);
    }
  });

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      if (gestureFor(canvas).isClick(event.delta)) onLaunch?.(event.point.x, event.point.z);
    },
    [canvas, onLaunch],
  );
  useEffect(() => {
    if (onLaunch) gestureFor(canvas);
  }, [canvas, onLaunch]);

  return (
    <group>
      <mesh
        geometry={water}
        material={material}
        receiveShadow
        onClick={onLaunch ? handleClick : undefined}
      />
      <mesh rotation-x={-Math.PI / 2} position-y={WATER_LEVEL - FAR_DROP}>
        <circleGeometry args={[GROUND_RADIUS, 72]} />
        <meshLambertMaterial color={DEEP} />
      </mesh>
      <mesh geometry={foam} renderOrder={1}>
        <meshBasicMaterial
          ref={foamMaterial}
          vertexColors
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

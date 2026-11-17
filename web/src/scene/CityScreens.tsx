import { useFrame } from "@react-three/fiber";
import { type Ref, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  type Mesh,
  type MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from "three";
import { useReducedMotion } from "./blobMedia.ts";
import { CURB } from "./CityGround.tsx";
import type { CityLayout, CityPanel } from "./layoutCity.ts";
import { newsPlaceholder, newsTicker, SCREEN_LOOKS } from "./newsPlaceholder.ts";

const UNIT_PLANE = new PlaneGeometry(1, 1);
const BEZEL = 0.35; // dark frame round each screen
const BEZEL_DEPTH = 0.3;
const TICKER_SPEED = 0.04; // strip lengths per second

interface ScreenProps {
  panel: CityPanel;
  /**
   * What the screen shows. Anything three can sample works: a CanvasTexture (placeholder or
   * an animated canvas), an image, a VideoTexture, or a render target's .texture.
   */
  content: Texture;
  ref?: Ref<Mesh>;
}

/** One screen: an unlit panel, so it glows whatever the light. One draw call. */
export function CityScreen({ panel, content, ref }: ScreenProps) {
  return (
    <mesh
      ref={ref}
      geometry={UNIT_PLANE}
      position={[panel.x, CURB + panel.y, panel.z]}
      rotation-y={panel.rotationY}
      scale={[panel.width, panel.height, 1]}
    >
      <meshBasicMaterial map={content} toneMapped={false} />
    </mesh>
  );
}

/** The plaza's screens with their frames, and the tower's scrolling news ticker. */
export function CityScreens({ city }: { city: CityLayout }) {
  // The real news story plugs in here: swap a placeholder for a texture drawn from it.
  const placeholders = useMemo(
    () =>
      city.screens.map((s, i) =>
        newsPlaceholder(s.width / s.height, SCREEN_LOOKS[i % SCREEN_LOOKS.length]),
      ),
    [city.screens],
  );
  useEffect(() => () => placeholders.forEach((t) => t.dispose()), [placeholders]);

  const ticker = useMemo(() => newsTicker(), []);
  useEffect(() => () => ticker.dispose(), [ticker]);

  const bezels = useRef<InstancedMesh>(null);
  const bezelGeometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  useEffect(() => () => bezelGeometry.dispose(), [bezelGeometry]);
  const panels = useMemo(() => [...city.screens, ...city.tickers], [city.screens, city.tickers]);

  useLayoutEffect(() => {
    const mesh = bezels.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const turn = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const behind = new Vector3();
    const size = new Vector3();
    panels.forEach((p, i) => {
      // Sits just behind the panel, a little bigger, so it frames it.
      turn.setFromAxisAngle(up, p.rotationY);
      behind.set(0, 0, -BEZEL_DEPTH / 2 - 0.02).applyQuaternion(turn);
      behind.x += p.x;
      behind.y += CURB + p.y;
      behind.z += p.z;
      size.set(p.width + 2 * BEZEL, p.height + 2 * BEZEL, BEZEL_DEPTH);
      mesh.setMatrixAt(i, matrix.compose(behind, turn, size));
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Frustum culling caches the instances' bounding sphere; refresh it with the matrices.
    mesh.computeBoundingSphere();
  }, [panels]);

  // The strip keeps its text's proportions on a panel of any length.
  const strip = city.tickers[0];
  useLayoutEffect(() => {
    if (!strip) return;
    const image = ticker.image as HTMLCanvasElement;
    ticker.repeat.set(strip.width / (strip.height * (image.width / image.height)), 1);
  }, [ticker, strip]);

  const reducedMotion = useReducedMotion();
  const tickerMesh = useRef<Mesh>(null);
  useFrame((_, delta) => {
    const map = (tickerMesh.current?.material as MeshBasicMaterial | undefined)?.map;
    if (reducedMotion || !map) return;
    // Scrolls by moving the texture, not by redrawing the canvas. Every ticker shares it.
    map.offset.x = (map.offset.x + delta * TICKER_SPEED) % 1;
  });

  return (
    <group>
      {city.screens.map((panel, i) => (
        <CityScreen key={i} panel={panel} content={placeholders[i]} />
      ))}
      {city.tickers.map((panel, i) => (
        <CityScreen
          key={`ticker-${i}`}
          ref={i === 0 ? tickerMesh : undefined}
          panel={panel}
          content={ticker}
        />
      ))}
      <instancedMesh
        ref={bezels}
        args={[bezelGeometry, undefined, panels.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial color="#20242c" />
      </instancedMesh>
    </group>
  );
}

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
import type { CityLayout, CityPanel, TickerStrip } from "./layoutCity.ts";
import {
  ADS,
  adPlaceholder,
  newsPlaceholder,
  newsTicker,
  SCREEN_LOOKS,
} from "./screenPlaceholders.ts";

const UNIT_PLANE = new PlaneGeometry(1, 1);

// A unit panel whose u runs over this strip's stretch of its run, in lengths of the ticker
// texture (one texture length is the strip's height times the texture's aspect).
function tickerGeometry(strip: TickerStrip, textureAspect: number): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1);
  const uv = geometry.getAttribute("uv");
  const perUnit = 1 / (strip.height * textureAspect);
  for (let i = 0; i < uv.count; i++) {
    uv.setX(i, (strip.run + uv.getX(i) * strip.width) * perUnit);
  }
  return geometry;
}
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
  /** Height the panel's y is measured from: the city's raised paving unless given. */
  base?: number;
  ref?: Ref<Mesh>;
}

/** One screen: an unlit panel, so it glows whatever the light. One draw call. */
export function CityScreen({ panel, content, base = CURB, ref }: ScreenProps) {
  return (
    <mesh
      ref={ref}
      geometry={UNIT_PLANE}
      position={[panel.x, base + panel.y, panel.z]}
      rotation-y={panel.rotationY}
      scale={[panel.width, panel.height, 1]}
    >
      <meshBasicMaterial map={content} toneMapped={false} />
    </mesh>
  );
}

/** The plaza's screens with their frames, and the tower's scrolling news ticker. */
export function CityScreens({ city }: { city: CityLayout }) {
  // Real content plugs in here: swap a screen's placeholder for a texture drawn from the
  // story (news) or from whatever the screen should show (ads).
  const placeholders = useMemo(
    () =>
      city.screens.map((s, i) => {
        // Its place among screens of its kind, so neighbours show different looks.
        const n = city.screens.slice(0, i).filter((o) => o.content === s.content).length;
        return s.content === "news"
          ? newsPlaceholder(s.width / s.height, SCREEN_LOOKS[n % SCREEN_LOOKS.length])
          : adPlaceholder(s.width / s.height, ADS[n % ADS.length]);
      }),
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

  // Each strip samples its stretch of the run, so the text keeps its proportions and carries
  // on round a corner from one strip to the next.
  const stripGeometries = useMemo(() => {
    const image = ticker.image as HTMLCanvasElement;
    return city.tickers.map((strip) => tickerGeometry(strip, image.width / image.height));
  }, [ticker, city.tickers]);
  useEffect(() => () => stripGeometries.forEach((g) => g.dispose()), [stripGeometries]);

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
      {city.tickers.map((strip, i) => (
        <mesh
          key={`ticker-${i}`}
          ref={i === 0 ? tickerMesh : undefined}
          geometry={stripGeometries[i]}
          position={[strip.x, CURB + strip.y, strip.z]}
          rotation-y={strip.rotationY}
          scale={[strip.width, strip.height, 1]}
        >
          <meshBasicMaterial map={ticker} toneMapped={false} />
        </mesh>
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

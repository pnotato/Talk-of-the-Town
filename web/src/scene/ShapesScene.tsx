import { Grid, OrbitControls, type OrbitControlsChangeEvent } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  type ComponentRef,
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  type Box3,
  type BufferGeometry,
  type DirectionalLight,
  type Fog,
  MathUtils,
  Matrix4,
  type Mesh,
  type ShaderMaterial,
  Vector3,
} from "three";
import { useBlobSelection } from "../inspector/BlobSelection.tsx";
import Blob from "./Blob.tsx";
import { MOOD_FIRST_ID, scenarioFirstId, staticActivities } from "./blobActivity.ts";
import { mediaQuery, useReducedMotion } from "./blobMedia.ts";
import { MOODS } from "./blobMood.ts";
import { gestureFor } from "./blobPicking.ts";
import BlobScenario from "./BlobScenario.tsx";
import { SCENARIOS } from "./blobScenarios.ts";
import { RenderResolution } from "./RenderResolution.tsx";
import { shapesFixture } from "./shapesFixture.ts";
import {
  FOV,
  type Label,
  LIGHT_POSITION,
  MOOD_ROW_SHAPE,
  VIEWS,
  type View,
  fitDistance,
} from "./shapesLayout.ts";

const SKY = "#d4e2ee";
const GROUND = "#9cad93";

const panBefore = new Vector3();

// Panning slides the target over the ground (screenSpacePanning is off). Keep it over the content
// and move the camera by the same amount, so the view slides instead of turning.
function keepTargetOver({ min, max }: Box3, event?: OrbitControlsChangeEvent) {
  if (!event) return;
  const { target, object } = event.target;
  panBefore.copy(target);
  target.x = MathUtils.clamp(target.x, min.x, max.x);
  target.z = MathUtils.clamp(target.z, min.z, max.z);
  object.position.add(panBefore.subVectors(target, panBefore));
}

const portrait = mediaQuery("(orientation: portrait)");

const viewDirection = new Vector3();

// Nothing about the grid is clickable; only the ground under it is.
const noRaycast = () => {};

/**
 * Frames the view for the current viewport, with orbit controls, fog and ground to match. A click
 * on the bare ground calls `onDismiss`; a blob in front swallows its own click, so that never
 * fires for the click that selected it. The end of an orbit or pan drag is not a click.
 */
function Stage({ view, onDismiss }: { view: View; onDismiss: () => void }) {
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const distance = fitDistance(view, aspect);
  const reduceMotion = useReducedMotion();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const fog = useRef<Fog>(null);
  // Start watching gestures before the first press: a click can only be judged by what led to it.
  useEffect(() => {
    gestureFor(canvas);
  }, [canvas]);
  const dismissOnClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (gestureFor(canvas).isClick(event.delta)) onDismiss();
    },
    [canvas, onDismiss],
  );
  const grid = useRef<Mesh<BufferGeometry, ShaderMaterial>>(null);

  // Reframe on mount and whenever the viewport's shape changes; this also undoes any pan.
  useLayoutEffect(() => {
    controls.current?.target.copy(view.target);
    camera.position.copy(view.toCamera).multiplyScalar(distance).add(view.target);
    camera.lookAt(view.target);
  }, [camera, view, distance]);

  // Fog starts just behind the content wherever the camera is, so it never tints one row more than
  // another, and fades the far ground into the sky. The grid isn't fogged, so it fades out with it.
  useFrame(() => {
    const target = controls.current?.target;
    if (!target || !fog.current || !grid.current) return;
    const cameraDistance = viewDirection.subVectors(camera.position, target).length();
    viewDirection.divideScalar(cameraDistance);
    let behindTarget = 0;
    for (const corner of view.contentCorners) {
      behindTarget = Math.max(behindTarget, viewDirection.dot(target) - viewDirection.dot(corner));
    }
    fog.current.near = cameraDistance + behindTarget;
    fog.current.far = fog.current.near + Math.max(cameraDistance, distance);
    grid.current.material.uniforms.fadeDistance.value = fog.current.far;
  });

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping={!reduceMotion}
        screenSpacePanning={false}
        minDistance={3}
        maxDistance={distance * 1.6}
        minPolarAngle={MathUtils.degToRad(5)}
        maxPolarAngle={MathUtils.degToRad(80)}
        onChange={(event) => keepTargetOver(view.content, event)}
      />
      <fog ref={fog} attach="fog" args={[SKY]} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={dismissOnClick}>
        <planeGeometry args={[2000, 2000]} />
        <meshStandardMaterial color={GROUND} />
      </mesh>
      <Grid
        ref={grid}
        raycast={noRaycast}
        position-y={0.002}
        infiniteGrid
        cellSize={1}
        cellThickness={0.6}
        cellColor="#90a488"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#8a9e82"
        fadeStrength={1.5}
      />
    </>
  );
}

/** Sun with soft shadows. Its shadow camera follows the view, so it stays fitted to the content. */
function KeyLight({ view }: { view: View }) {
  const light = useRef<DirectionalLight>(null);

  // three only refreshes a shadow camera's projection when it first allocates the shadow map.
  useLayoutEffect(() => {
    const camera = light.current!.shadow.camera;
    Object.assign(camera, view.shadow);
    camera.updateProjectionMatrix();
  }, [view]);

  // No shadow bias: three draws the back faces of closed meshes into the shadow map, so lit
  // surfaces never shadow themselves, and any bias opens a lit gap under round-bottomed blobs.
  return (
    <directionalLight
      ref={light}
      position={LIGHT_POSITION}
      intensity={2.4}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-radius={5}
    />
  );
}

/** Pins a label element to a point in the canvas (centred on it, or on top of it), or hides it. */
function pin(element: HTMLElement, x: number, y: number, above: boolean, visible: boolean) {
  element.style.visibility = visible ? "visible" : "hidden";
  element.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${above ? -100 : -50}%)`;
}

const ndc = new Vector3();

/**
 * Keeps each label element over its anchor. A plain DOM overlay rather than drei's <Html>, which
 * mounts a React root per label and drops labels under StrictMode. Styles are only written when
 * the view changes.
 */
function PinLabels({
  labels,
  elements,
}: {
  labels: Label[];
  elements: RefObject<(HTMLDivElement | null)[]>;
}) {
  const lastLabels = useRef<Label[]>(null);
  const lastWorld = useRef(new Matrix4());
  const lastProjection = useRef(new Matrix4());

  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    if (
      lastLabels.current === labels &&
      lastWorld.current.equals(camera.matrixWorld) &&
      lastProjection.current.equals(camera.projectionMatrix)
    ) {
      return;
    }
    lastLabels.current = labels;
    lastWorld.current.copy(camera.matrixWorld);
    lastProjection.current.copy(camera.projectionMatrix);
    for (let i = 0; i < labels.length; i++) {
      const element = elements.current[i];
      if (!element) continue;
      ndc.copy(labels[i].at).project(camera);
      // Outside the depth range means behind the camera or past the far plane.
      const visible = Math.abs(ndc.z) < 1;
      const x = ((ndc.x + 1) / 2) * size.width;
      const y = ((1 - ndc.y) / 2) * size.height;
      pin(element, x, y, labels[i].above ?? false, visible);
    }
  });
  return null;
}

const labelStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  visibility: "hidden", // until PinLabels places it
  pointerEvents: "none",
  padding: "2px 6px",
  borderRadius: 6,
  background: "rgb(255 255 255 / 0.85)",
  boxShadow: "0 1px 2px rgb(0 0 0 / 0.15)",
  color: "#1f2328",
  font: "500 12px/1.3 system-ui, sans-serif",
  textAlign: "center",
  // Long meanings wrap onto a second line instead of running into the next label.
  maxWidth: 78,
  width: "max-content",
};

/** Every blob shape at child, adult and elder size, on an empty ground. */
export default function ShapesScene() {
  const tall = useSyncExternalStore(portrait.subscribe, portrait.matches);
  const view = tall ? VIEWS.tall : VIEWS.wide;
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const { selectedId, selectBlob, updateActivities } = useBlobSelection();
  const dismiss = useCallback(() => selectBlob(null), [selectBlob]);

  // The grid and the mood samples never change what they do; the scenarios report their own.
  useEffect(() => {
    updateActivities(staticActivities());
  }, [updateActivities]);

  return (
    <section
      aria-label="Blob shapes sandbox"
      // isolation keeps the labels below the app shell, which overlays the page.
      style={{ position: "relative", height: "100%", overflow: "hidden", isolation: "isolate" }}
    >
      <Canvas
        // PCF softened by shadow-radius. A bare `shadows` asks for PCFSoftShadowMap, which three
        // r187 has removed (it warns and falls back).
        shadows="percentage"
        flat
        dpr={1}
        camera={{ fov: FOV, near: 0.1, far: 1000 }}
      >
        <RenderResolution />
        <color attach="background" args={[SKY]} />
        {/* Balanced with KeyLight so a lit top face shows a blob's base colour (no tone mapping). */}
        <hemisphereLight args={["#eef4fa", "#7d8f6e", 1.6]} />
        <KeyLight view={view} />
        <Stage view={view} onDismiss={dismiss} />
        <PinLabels labels={view.labels} elements={labels} />

        {shapesFixture.map((blob, i) => (
          <Blob
            key={blob.id}
            id={blob.id}
            shape={blob.shape}
            age={blob.age}
            position={view.grid[i]}
            selected={selectedId === blob.id}
            onSelect={selectBlob}
          />
        ))}
        {MOODS.map((mood, i) => (
          <Blob
            key={mood}
            id={MOOD_FIRST_ID + i}
            shape={MOOD_ROW_SHAPE}
            age={35}
            mood={mood}
            idle
            position={view.moods[i]}
            selected={selectedId === MOOD_FIRST_ID + i}
            onSelect={selectBlob}
          />
        ))}
        {SCENARIOS.map((scenario, i) => (
          <BlobScenario
            key={scenario.title}
            scenario={scenario}
            position={view.actions[i]}
            firstId={scenarioFirstId(i)}
            selectedId={selectedId}
            onSelect={selectBlob}
            onActivityChange={updateActivities}
          />
        ))}
      </Canvas>

      {view.labels.map((label, i) => (
        <div
          key={label.title}
          ref={(element) => {
            labels.current[i] = element;
          }}
          style={labelStyle}
        >
          {label.detail ? (
            <>
              <strong>{label.title}</strong>
              <br />
              {label.detail}
            </>
          ) : (
            label.title
          )}
        </div>
      ))}
    </section>
  );
}

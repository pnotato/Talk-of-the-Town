import { Grid, OrbitControls, type OrbitControlsChangeEvent } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type ComponentRef,
  type CSSProperties,
  type RefObject,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  Box3,
  type DirectionalLight,
  type Fog,
  MathUtils,
  Matrix4,
  OrthographicCamera,
  Vector3,
  type Vector3Tuple,
} from "three";
import Blob from "./Blob.tsx";
import { SHAPES } from "./blobGeometry.ts";
import { AGE_GROUPS, type AgeGroup, ageGroup } from "./blobSize.ts";
import { shapesFixture } from "./shapesFixture.ts";

const SKY = "#d4e2ee";
const GROUND = "#9cad93";
const FOV = 35;

type Label = { at: Vector3; title: string; detail?: string };

type Layout = {
  /** Where each shapesFixture blob stands, by index. */
  positions: Vector3Tuple[];
  labels: Label[];
  /** Camera angle above the ground. */
  elevation: number;
};

const GROUP_NAME: Record<AgeGroup, string> = { child: "Child", adult: "Adult", elder: "Elder" };

function ageLabel(group: AgeGroup) {
  const ages = new Set(shapesFixture.map((b) => b.age).filter((age) => ageGroup(age) === group));
  return { title: GROUP_NAME[group], detail: `age ${[...ages].join(", ")}` };
}

const centred = (index: number, count: number, gap: number) => (index - (count - 1) / 2) * gap;

// Wide screens: a column per shape and a row per age group. Children in front and elders at the
// back, so perspective works against the size cue: if the rows read clearly here, they read
// anywhere in the town.
const WIDE: Layout = (() => {
  const x = (i: number) => centred(i, SHAPES.length, 1.8);
  const z: Record<AgeGroup, number> = { child: 3, adult: 0, elder: -3 };
  return {
    elevation: MathUtils.degToRad(38),
    positions: shapesFixture.map((b) => [x(SHAPES.indexOf(b.shape)), 0, z[ageGroup(b.age)]]),
    labels: [
      ...SHAPES.map((shape, i) => ({ at: new Vector3(x(i), 0, z.child + 0.95), title: shape })),
      ...AGE_GROUPS.map((group) => ({
        at: new Vector3(x(0) - 1.5, 0.3, z[group]),
        ...ageLabel(group),
      })),
    ],
  };
})();

// Tall screens (phones): transposed, so the six shapes run down the screen instead of across it.
// Age groups stand side by side at the same depth, which keeps the size comparison fair.
const TALL: Layout = (() => {
  const x = (group: AgeGroup) => centred(AGE_GROUPS.indexOf(group), AGE_GROUPS.length, 1.9);
  const z = (i: number) => centred(i, SHAPES.length, 2.2);
  return {
    elevation: MathUtils.degToRad(45),
    positions: shapesFixture.map((b) => [x(ageGroup(b.age)), 0, z(SHAPES.indexOf(b.shape))]),
    labels: [
      ...SHAPES.map((shape, i) => ({ at: new Vector3(x("child") - 1.5, 0.3, z(i)), title: shape })),
      ...AGE_GROUPS.map((group) => ({
        at: new Vector3(x(group), 0, z(SHAPES.length - 1) + 1.1),
        ...ageLabel(group),
      })),
    ],
  };
})();

function corners({ min, max }: Box3): Vector3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => new Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z),
  );
}

// Key light from the front right and high, so shadows fall back and to the left as in
// docs/blobs.png.
const LIGHT_POSITION = new Vector3(5, 10, 6);

/**
 * Orthographic shadow camera bounds that fit `content` as seen from the light, so the shadow map is
 * spent on the blobs. A shadow lands further along the light ray than its caster, so `far` reaches
 * past the content to the ground behind it.
 */
function fitShadowCamera(content: Box3) {
  const light = new OrthographicCamera();
  light.position.copy(LIGHT_POSITION);
  light.lookAt(0, 0, 0);
  light.updateMatrixWorld();
  const { min, max } = new Box3().setFromPoints(
    corners(content).map((c) => c.applyMatrix4(light.matrixWorldInverse)),
  );
  const pad = 0.5;
  return {
    left: min.x - pad,
    right: max.x + pad,
    bottom: min.y - pad,
    top: max.y + pad,
    near: -max.z - pad,
    far: -min.z + 4,
  };
}

// Rough world-space half sizes of an elder's footprint and of a label, for framing.
const BLOB_EXTENT = new Vector3(0.75, 0, 0.75);
const BLOB_TOP = 1.35;
const LABEL_EXTENT = new Vector3(0.7, 0, 0.3);

/** Everything the camera and the shadow map need to frame one layout. */
function frame(layout: Layout) {
  const content = new Box3();
  for (const position of layout.positions) {
    const base = new Vector3(...position);
    content.expandByPoint(base.clone().sub(BLOB_EXTENT));
    content.expandByPoint(base.add(BLOB_EXTENT).setY(BLOB_TOP));
  }
  for (const { at } of layout.labels) {
    content.expandByPoint(at.clone().sub(LABEL_EXTENT));
    content.expandByPoint(at.clone().add(LABEL_EXTENT));
  }
  return {
    ...layout,
    content,
    contentCorners: corners(content),
    // Aim at about mid-height of an adult blob.
    target: content.getCenter(new Vector3()).setY(0.45),
    // Straight on, looking down at the target.
    toCamera: new Vector3(0, Math.sin(layout.elevation), Math.cos(layout.elevation)),
    cameraUp: new Vector3(0, Math.cos(layout.elevation), -Math.sin(layout.elevation)),
    shadow: fitShadowCamera(content),
  };
}

type View = ReturnType<typeof frame>;

const VIEWS = { wide: frame(WIDE), tall: frame(TALL) };

const fromTarget = new Vector3();
const viewDirection = new Vector3();

/** Closest camera distance along `toCamera` that keeps all content inside 90% of the view. */
function fitDistance(view: View, aspect: number) {
  const tanV = 0.9 * Math.tan(MathUtils.degToRad(FOV / 2));
  const tanH = tanV * aspect;
  let distance = 0;
  for (const corner of view.contentCorners) {
    const p = fromTarget.subVectors(corner, view.target);
    const depth = p.dot(view.toCamera);
    distance = Math.max(
      distance,
      depth + Math.abs(p.x) / tanH,
      depth + Math.abs(p.dot(view.cameraUp)) / tanV,
    );
  }
  return distance;
}

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

function mediaQuery(query: string) {
  const list = matchMedia(query);
  return {
    subscribe(onChange: () => void) {
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    matches: () => list.matches,
  };
}

const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
const portrait = mediaQuery("(orientation: portrait)");

/** Frames the view for the current viewport, with orbit controls, fog and ground to match. */
function Stage({ view }: { view: View }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const distance = fitDistance(view, aspect);
  const reduceMotion = useSyncExternalStore(reducedMotion.subscribe, reducedMotion.matches);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const fog = useRef<Fog>(null);

  // Reframe on mount and whenever the viewport's shape changes; this also undoes any pan.
  useLayoutEffect(() => {
    controls.current?.target.copy(view.target);
    camera.position.copy(view.toCamera).multiplyScalar(distance).add(view.target);
    camera.lookAt(view.target);
  }, [camera, view, distance]);

  // Fog starts just behind the content wherever the camera is, so it never tints one row more than
  // another, and fades the far ground into the sky.
  useFrame(() => {
    const target = controls.current?.target;
    if (!target || !fog.current) return;
    const cameraDistance = viewDirection.subVectors(camera.position, target).length();
    viewDirection.divideScalar(cameraDistance);
    let behindTarget = 0;
    for (const corner of view.contentCorners) {
      behindTarget = Math.max(behindTarget, viewDirection.dot(target) - viewDirection.dot(corner));
    }
    fog.current.near = cameraDistance + behindTarget;
    fog.current.far = fog.current.near + cameraDistance;
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
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <meshStandardMaterial color={GROUND} />
      </mesh>
      <Grid
        position-y={0.002}
        infiniteGrid
        cellSize={1}
        cellThickness={0.6}
        cellColor="#90a488"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#8a9e82"
        // Fade by distance from the grid centre, not the camera, so zooming doesn't move the edge.
        fadeFrom={0}
        fadeDistance={40}
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

/** Centres a label element on a point in the canvas, or hides it. */
function pin(element: HTMLElement, x: number, y: number, visible: boolean) {
  element.style.visibility = visible ? "visible" : "hidden";
  element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
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
      pin(element, ((ndc.x + 1) / 2) * size.width, ((1 - ndc.y) / 2) * size.height, visible);
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
  padding: "2px 8px",
  borderRadius: 6,
  background: "rgb(255 255 255 / 0.85)",
  boxShadow: "0 1px 2px rgb(0 0 0 / 0.15)",
  color: "#1f2328",
  font: "500 13px/1.3 system-ui, sans-serif",
  textAlign: "center",
  whiteSpace: "nowrap",
};

/** Every blob shape at child, adult and elder size, on an empty ground. */
export default function ShapesScene() {
  const tall = useSyncExternalStore(portrait.subscribe, portrait.matches);
  const view = tall ? VIEWS.tall : VIEWS.wide;
  const labels = useRef<(HTMLDivElement | null)[]>([]);

  return (
    <section
      aria-label="Blob shapes sandbox"
      // isolation keeps the labels below the app shell, which overlays the page.
      style={{ position: "relative", height: "100%", overflow: "hidden", isolation: "isolate" }}
    >
      <Canvas shadows="percentage" flat camera={{ fov: FOV, near: 0.1, far: 1000 }}>
        <color attach="background" args={[SKY]} />
        {/* Balanced with KeyLight so a lit top face shows a blob's base colour (no tone mapping). */}
        <hemisphereLight args={["#eef4fa", "#7d8f6e", 1.6]} />
        <KeyLight view={view} />
        <Stage view={view} />
        <PinLabels labels={view.labels} elements={labels} />

        {shapesFixture.map((blob, i) => (
          <Blob key={blob.id} shape={blob.shape} age={blob.age} position={view.positions[i]} />
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

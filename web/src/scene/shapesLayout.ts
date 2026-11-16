import { Box3, MathUtils, OrthographicCamera, Vector3, type Vector3Tuple } from "three";
import { SHAPES } from "./blobGeometry.ts";
import { AGE_GROUPS, type AgeGroup, ageGroup } from "./blobSize.ts";
import { shapesFixture } from "./shapesFixture.ts";

// Where the Shapes sandbox puts its blobs and labels, and how the camera and the sun frame them.

export const FOV = 35;

// Key light from the front right and high, so shadows fall back and to the left as in
// docs/blobs.png.
export const LIGHT_POSITION = new Vector3(5, 10, 6);

export type Label = { at: Vector3; title: string; detail?: string };

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

/** A layout plus everything the camera and the shadow map need to frame it. */
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
    /** Everything that must stay in view and in the shadow map. */
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

export type View = ReturnType<typeof frame>;

export const VIEWS = { wide: frame(WIDE), tall: frame(TALL) };

const fromTarget = new Vector3();

/** Closest camera distance along `toCamera` that keeps all content inside 90% of the view. */
export function fitDistance(view: View, aspect: number) {
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

import { Box3, MathUtils, OrthographicCamera, Vector3, type Vector3Tuple } from "three";
import { type Shape, SHAPES } from "./blobGeometry.ts";
import { MOOD_MEANING, MOODS, type Mood } from "./blobMood.ts";
import { type Scenario, SCENARIOS, scenarioHalfWidth } from "./blobScenarios.ts";
import { AGE_GROUPS, type AgeGroup, ageGroup } from "./blobSize.ts";
import { shapesFixture } from "./shapesFixture.ts";

// Where the Shapes sandbox puts its blobs and labels, and how the camera and the sun frame them.

// A narrow field of view from further back keeps the front and back rows at similar sizes.
export const FOV = 26;

// Key light from the front right and high, so shadows fall back and to the left as in
// docs/blobs.png.
export const LIGHT_POSITION = new Vector3(5, 10, 6);

/** A label pinned to a point in the scene: centred on it, or sitting on top of it if `above`. */
export type Label = { at: Vector3; title: string; detail?: string; above?: boolean };

type Layout = {
  /** Where each shapesFixture blob stands, by index. */
  grid: Vector3Tuple[];
  /** Where the Moods row's blob for each of MOODS stands, by index. */
  moods: Vector3Tuple[];
  /** The centre of each of SCENARIOS, by index. */
  actions: Vector3Tuple[];
  labels: Label[];
  /** Camera angle above the ground. */
  elevation: number;
};

/** The Moods row uses one shape, so mood is the only thing that changes along it. */
export const MOOD_ROW_SHAPE: Shape = "square";

const GROUP_NAME: Record<AgeGroup, string> = { child: "Child", adult: "Adult", elder: "Elder" };

function ageLabel(group: AgeGroup) {
  const ages = new Set(shapesFixture.map((b) => b.age).filter((age) => ageGroup(age) === group));
  return { title: GROUP_NAME[group], detail: `age ${[...ages].join(", ")}` };
}

const moodLabel = (mood: Mood) => ({ title: mood, detail: MOOD_MEANING[mood] });
const actionLabel = ({ title, detail }: Scenario) => ({ title, detail });
const MOODS_LABEL = { title: "Moods" };
const ACTIONS_LABEL = { title: "Actions" };

const centred = (index: number, count: number, gap: number) => (index - (count - 1) / 2) * gap;

/** Centres for items of the given widths laid side by side, `gap` apart, centred on x = 0. */
function packed(widths: number[], gap: number) {
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  let left = -total / 2;
  return widths.map((w) => {
    const centre = left + w / 2;
    left += w + gap;
    return centre;
  });
}

// Room a scenario needs across: its actors' reach plus a body either side.
const ACTION_WIDTHS = SCENARIOS.map((s) => 2 * scenarioHalfWidth(s) + 1);

// Wide screens, back to front: the Moods row, then a column per shape and a row per age group,
// then the Actions. Children stand in front of adults and elders, so perspective works against the
// size cue: if the rows read clearly here, they read anywhere in the town.
const WIDE: Layout = (() => {
  const x = (i: number) => centred(i, SHAPES.length, 1.8);
  const z: Record<AgeGroup, number> = { child: 2.8, adult: 0, elder: -2.8 };
  const [moodsZ, actionsZ, sideX] = [-5.7, 6.4, x(0) - 1.5];
  const moodX = (i: number) => centred(i, MOODS.length, 1.9);
  const actionX = packed(ACTION_WIDTHS, 0.4);
  return {
    elevation: MathUtils.degToRad(40),
    grid: shapesFixture.map((b) => [x(SHAPES.indexOf(b.shape)), 0, z[ageGroup(b.age)]]),
    moods: MOODS.map((_, i) => [moodX(i), 0, moodsZ]),
    actions: SCENARIOS.map((_, i) => [actionX[i], 0, actionsZ]),
    labels: [
      ...SHAPES.map((shape, i) => ({ at: new Vector3(x(i), 0, z.child + 0.95), title: shape })),
      ...AGE_GROUPS.map((g) => ({ at: new Vector3(sideX, 0.3, z[g]), ...ageLabel(g) })),
      { at: new Vector3(moodX(0) - 1.3, 0.3, moodsZ), ...MOODS_LABEL },
      // Above the back row's heads, where there's nothing behind them to cover.
      ...MOODS.map((m, i) => ({
        at: new Vector3(moodX(i), 1.1, moodsZ),
        above: true,
        ...moodLabel(m),
      })),
      { at: new Vector3(actionX[0] - ACTION_WIDTHS[0] / 2 - 0.7, 0.3, actionsZ), ...ACTIONS_LABEL },
      ...SCENARIOS.map((s, i) => ({
        at: new Vector3(actionX[i], 0, actionsZ + 1.2),
        ...actionLabel(s),
      })),
    ],
  };
})();

// Tall screens (phones): the grid is transposed, so the six shapes run down the screen instead of
// across it, and age groups stand side by side at the same depth, which keeps the size comparison
// fair. Moods (two rows) and Actions (two by two) follow below.
const TALL: Layout = (() => {
  const x = (group: AgeGroup) => centred(AGE_GROUPS.indexOf(group), AGE_GROUPS.length, 1.9);
  const z = (i: number) => centred(i, SHAPES.length, 2.2);
  const moodsZ = z(SHAPES.length - 1) + 4.2;
  const moodSpot = (i: number): Vector3Tuple => {
    const [rowLength, row] = [4, Math.floor(i / 4)];
    const inRow = row === 0 ? rowLength : MOODS.length - rowLength;
    return [centred(i % rowLength, inRow, 1.9), 0, moodsZ + row * 2.4];
  };
  const actionsZ = moodsZ + 6.4;
  const actionSpot = (i: number): Vector3Tuple => [
    i % 2 ? 1.6 : -1.6,
    0,
    actionsZ + Math.floor(i / 2) * 3.8,
  ];
  return {
    elevation: MathUtils.degToRad(45),
    grid: shapesFixture.map((b) => [x(ageGroup(b.age)), 0, z(SHAPES.indexOf(b.shape))]),
    moods: MOODS.map((_, i) => moodSpot(i)),
    actions: SCENARIOS.map((_, i) => actionSpot(i)),
    labels: [
      ...SHAPES.map((shape, i) => ({ at: new Vector3(x("child") - 1.5, 0.3, z(i)), title: shape })),
      ...AGE_GROUPS.map((g) => ({
        at: new Vector3(x(g), 0, z(SHAPES.length - 1) + 1.1),
        ...ageLabel(g),
      })),
      { at: new Vector3(0, 0, moodsZ - 1.4), ...MOODS_LABEL },
      // Names only: a phone has no room for the meanings; faces and colours still carry them.
      ...MOODS.map((m, i) => ({
        at: new Vector3(...moodSpot(i)).setZ(moodSpot(i)[2] + 0.75),
        title: m,
      })),
      { at: new Vector3(0, 0, actionsZ - 1.9), ...ACTIONS_LABEL },
      ...SCENARIOS.map((s, i) => ({
        at: new Vector3(...actionSpot(i)).setZ(actionSpot(i)[2] + 1),
        ...actionLabel(s),
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

// Rough world-space sizes for framing: half extents of an elder's footprint and of a label, how
// tall a blob gets, and how high a speech bubble reaches.
const BLOB_EXTENT = new Vector3(0.75, 0, 0.75);
const BLOB_TOP = 1.35;
const BUBBLE_TOP = 1.8;
const LABEL_EXTENT = new Vector3(0.7, 0, 0.5);

/** A layout plus everything the camera and the shadow map need to frame it. */
function frame(layout: Layout) {
  const content = new Box3();
  const addBlobs = ([x, , z]: Vector3Tuple, halfWidth: number, top: number) => {
    content.expandByPoint(new Vector3(x - halfWidth, 0, z - BLOB_EXTENT.z));
    content.expandByPoint(new Vector3(x + halfWidth, top, z + BLOB_EXTENT.z));
  };
  for (const p of [...layout.grid, ...layout.moods]) addBlobs(p, BLOB_EXTENT.x, BLOB_TOP);
  layout.actions.forEach((p, i) =>
    addBlobs(p, scenarioHalfWidth(SCENARIOS[i]) + BLOB_EXTENT.x, BUBBLE_TOP),
  );
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

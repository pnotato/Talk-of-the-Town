// The town as a MapLayout, so the shared camera, shadows and (later) the blob replay treat it
// like any other map.
import {
  HOME_TOP,
  LAMP_HEIGHT,
  ROOF_PLANT,
  SQUARE_TREE_INSET,
  TREE_HEIGHT,
  TREE_RADIUS,
  type TownLayout,
  type TownRect,
  type TownTree,
} from "./layoutTown.ts";
import {
  type Box,
  type Disc,
  type MapLayout,
  type Obstacle,
  type Point,
  type Solid,
  SPOT_SPACING,
  standingSpots,
  type WalkArea,
} from "./mapLayout.ts";

/** A turned box's corners on the ground. */
export function boxCorners(b: Box): Point[] {
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  return [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([u, v]) => {
    const lx = (u * b.width) / 2;
    const lz = (v * b.depth) / 2;
    // three.js rotation.y takes local (lx, lz) here.
    return { x: b.x + c * lx + s * lz, z: b.z - s * lx + c * lz };
  });
}

const boxOf = ({ x, z, width, depth, rotationY }: Box): Box => ({ x, z, width, depth, rotationY });

/**
 * What a walking blob must go round on the square: the screen, the benches, lamps and flower
 * beds, and the canopies of the square's trees. The same list decides where spots are, so the
 * walk map and the scene always agree.
 */
export function townWalkObstacles(town: TownLayout): { what: string; obstacle: Obstacle }[] {
  const { square } = town;
  const inside = (t: TownTree, r: TownRect) =>
    Math.abs(t.x - r.x) < r.width / 2 && Math.abs(t.z - r.z) < r.depth / 2;
  const parks = town.blocks.filter((b) => b.kind === "park");
  const walked = (t: TownTree) => inside(t, square) || parks.some((p) => inside(t, p));
  return [
    { what: "screen", obstacle: { kind: "box", ...town.screen.footprint } },
    ...town.props.map((p) => ({
      what: p.kind,
      obstacle: { kind: "box" as const, ...boxOf(p) },
    })),
    ...town.trees.filter(walked).map((t) => ({
      what: "tree",
      obstacle: { kind: "disc" as const, x: t.x, z: t.z, radius: TREE_RADIUS * t.size },
    })),
  ];
}

function treeSolid(t: TownTree): Solid {
  const span = 2 * TREE_RADIUS * t.size;
  return { x: t.x, z: t.z, width: span, depth: span, rotationY: 0, height: TREE_HEIGHT * t.size };
}

export function townMap(town: TownLayout): MapLayout {
  const { square, screen } = town;

  // Everything the camera must keep out of, each with the height of its top.
  const solids: Solid[] = [
    ...town.homes.map((h) => ({ ...boxOf(h), height: HOME_TOP * h.heightScale })),
    ...town.buildings.map((b) => ({ ...boxOf(b), height: b.height + ROOF_PLANT })),
    ...town.buildings.flatMap((b) => (b.tower ? [b.tower] : [])),
    { ...screen.footprint, height: screen.top },
    ...town.props
      .filter((p) => p.kind === "lamp")
      .map((p) => ({ ...boxOf(p), height: LAMP_HEIGHT })),
    ...town.trees.map(treeSolid),
  ];

  // Blobs stand on the square's paving between its rows of trees, clear of the screen, the
  // benches, the lamps and the trees' canopies. Outside a row the paving is too narrow to walk,
  // and a blob that fit between a bench and a tree there would be boxed in.
  const width = square.width - 2 * SQUARE_TREE_INSET;
  const outline = boxCorners({ ...square, width, rotationY: 0 });
  const obstacles: Obstacle[] = townWalkObstacles(town).map((o) => o.obstacle);

  // The default view shows every block to its corners and everything taller than a tree.
  const frame = [
    ...town.blocks.flatMap((b) => boxCorners({ ...b, rotationY: 0 }).map((p) => ({ ...p, y: 0 }))),
    ...solids
      .filter((s) => s.height > TREE_HEIGHT)
      .flatMap((s) => boxCorners(s).map((p) => ({ ...p, y: s.height }))),
  ];
  const casters: Disc[] = solids.map((s) => ({
    x: s.x,
    z: s.z,
    radius: Math.hypot(s.width, s.depth) / 2,
  }));

  return {
    homes: town.homes.map((h) => ({
      index: h.index,
      neighbourhood: h.neighbourhood,
      door: {
        x: h.x + Math.sin(h.rotationY) * (h.depth / 2),
        z: h.z + Math.cos(h.rotationY) * (h.depth / 2),
      },
      facing: h.rotationY,
    })),
    neighbourhoods: town.neighbourhoods.map((n) => ({
      index: n.index,
      homeCount: n.homeCount,
      centre: { x: n.x, z: n.z },
    })),
    gathering: {
      areas: walkAreas(town, outline, obstacles),
    },
    bounds: town.bounds,
    roam: "box",
    frame,
    casters,
    solids,
    height: town.height,
  };
}

// Where blobs walk: the square first, then the greens (lawn and sidewalk, kerb to kerb), then
// the streets, which in this car-free town are as good as a path. The road out of town is left
// to the fields. Where areas meet, a later one drops cells closer than the spacing to earlier
// ones, so neighbours never crowd.
function walkAreas(town: TownLayout, square: Point[], obstacles: Obstacle[]): WalkArea[] {
  const area = (name: string, r: TownRect): WalkArea => {
    const outline = boxCorners({ ...r, rotationY: 0 });
    return { name, outline, spots: standingSpots(outline, obstacles) };
  };
  const areas: WalkArea[] = [
    { name: "square", outline: square, spots: standingSpots(square, obstacles) },
    ...town.blocks.filter((b) => b.kind === "park").map((b) => area("park", b)),
    ...town.streets.filter((s) => !s.out).map((s) => area("street", s)),
  ];
  const kept: Point[] = [];
  for (const a of areas) {
    a.spots = a.spots.filter((p) =>
      kept.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= SPOT_SPACING - 1e-9),
    );
    kept.push(...a.spots);
  }
  return areas;
}

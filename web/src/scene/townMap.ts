// The town as a MapLayout, so the shared camera, shadows and (later) the blob replay treat it
// like any other map.
import {
  HOME_TOP,
  LAMP_HEIGHT,
  ROOF_PLANT,
  TREE_HEIGHT,
  TREE_RADIUS,
  type TownLayout,
  type TownTree,
} from "./layoutTown.ts";
import {
  type Box,
  type Disc,
  type MapLayout,
  type Obstacle,
  type Point,
  type Solid,
  standingSpots,
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
  const near = Math.max(square.width, square.depth) / 2 + 2 * TREE_RADIUS;
  return [
    { what: "screen", obstacle: { kind: "box", ...town.screen.footprint } },
    ...town.props.map((p) => ({
      what: p.kind,
      obstacle: { kind: "box" as const, ...boxOf(p) },
    })),
    ...town.trees
      .filter((t) => Math.abs(t.x - square.x) < near && Math.abs(t.z - square.z) < near)
      .map((t) => ({
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

  // Blobs stand anywhere on the square's paving clear of the screen, the benches, the lamps
  // and the trees' canopies.
  const outline = boxCorners({ ...square, rotationY: 0 });
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
      areas: [{ name: "square", outline, spots: standingSpots(outline, obstacles) }],
    },
    bounds: town.bounds,
    roam: "box",
    frame,
    casters,
    solids,
    height: town.height,
  };
}

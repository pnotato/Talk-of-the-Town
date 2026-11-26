// The harbour as a MapLayout, so the shared camera, shadows and blob replay treat it like any
// other map.
import {
  carouselReach,
  type HarbourLayout,
  type HarbourProp,
  type HarbourRect,
  MAPLE_RADIUS,
  PINE_RADIUS,
} from "./layoutHarbour.ts";
import {
  type Box,
  distanceToBox,
  type MapLayout,
  type Obstacle,
  type Point,
  standingSpots,
  type WalkArea,
} from "./mapLayout.ts";
import { boxCorners } from "./townMap.ts";

// A tree further than this from every walkable area can't get in a walking blob's way.
const TREE_REACH = 2;

const rectBox = (r: HarbourRect): Box => ({ ...r, rotationY: 0 });

/** The walkable rectangles, the main gathering place first, each with its name. */
export function harbourAreas(h: HarbourLayout): { name: string; rect: HarbourRect }[] {
  return [
    { name: "green", rect: h.green },
    { name: "boardwalk", rect: h.boardwalk },
    { name: "pier", rect: h.pier },
    { name: "pierhead", rect: h.pierhead },
  ];
}

// Round things are discs; the rest keep their boxes, which are all turned by whole quarters.
function propObstacle(p: HarbourProp): Obstacle {
  switch (p.kind) {
    case "pole":
      return { kind: "disc", x: p.x, z: p.z, radius: 0.2 };
    case "bell":
      return { kind: "disc", x: p.x, z: p.z, radius: 0.6 };
    case "telescope":
      return { kind: "disc", x: p.x, z: p.z, radius: 0.3 };
    default:
      return {
        kind: "box",
        x: p.x,
        z: p.z,
        width: p.width,
        depth: p.depth,
        rotationY: p.rotationY,
      };
  }
}

/**
 * What a walking blob must go round: the carousel, the festoon poles, benches, planters, the bell,
 * the telescopes, the ice cream cart, and the canopies of trees by the walkable areas. The same
 * list decides where spots are, so the walk map and the scene always agree.
 */
export function harbourWalkObstacles(h: HarbourLayout): { what: string; obstacle: Obstacle }[] {
  const areas = harbourAreas(h).map((a) => rectBox(a.rect));
  const canopy = (kind: string) => (kind === "pine" ? PINE_RADIUS : MAPLE_RADIUS);
  return [
    {
      what: "carousel",
      obstacle: { kind: "disc", x: h.carousel.x, z: h.carousel.z, radius: carouselReach(h) },
    },
    ...h.props.map((p) => ({ what: p.kind, obstacle: propObstacle(p) })),
    ...h.trees
      .filter((t) =>
        areas.some((a) => distanceToBox(t.x, t.z, a) - canopy(t.kind) * t.size <= TREE_REACH),
      )
      .map((t) => ({
        what: "tree",
        obstacle: { kind: "disc" as const, x: t.x, z: t.z, radius: canopy(t.kind) * t.size },
      })),
  ];
}

export function harbourMap(h: HarbourLayout): MapLayout {
  const obstacles = harbourWalkObstacles(h).map((o) => o.obstacle);
  const areas: WalkArea[] = harbourAreas(h).map(({ name, rect }) => {
    const outline = boxCorners(rectBox(rect));
    return { name, outline, spots: standingSpots(outline, obstacles) };
  });

  // The default view shows every walkable area to its corners, the market and Front Street's
  // homes, the lighthouse's rock, and the tops of the ferris wheel, the lighthouse and the
  // floating screen.
  const { wheel, lighthouse, screen } = h;
  const tall = h.solids.filter(
    (s) =>
      (s.x === wheel.x && s.z === wheel.z) ||
      (s.x === lighthouse.x && s.z === lighthouse.z) ||
      (s.x === screen.barge.x && s.z === screen.barge.z),
  );
  const island = {
    x: lighthouse.x,
    z: lighthouse.z,
    width: 2 * lighthouse.island,
    depth: 2 * lighthouse.island,
    rotationY: 0,
  };
  const frontStreet = h.homes.filter((home) => home.neighbourhood < 2);
  const frame = [
    ...areas.flatMap((a) => a.outline.map((p: Point) => ({ ...p, y: 0 }))),
    ...tall.flatMap((s) => boxCorners(s).map((p) => ({ ...p, y: s.height }))),
    ...[island, ...h.stalls, ...frontStreet].flatMap((b) =>
      boxCorners(b).map((p) => ({ ...p, y: 0 })),
    ),
  ];

  return {
    homes: h.homes.map((home) => ({
      index: home.index,
      neighbourhood: home.neighbourhood,
      door: {
        x: home.x + Math.sin(home.rotationY) * (home.depth / 2),
        z: home.z + Math.cos(home.rotationY) * (home.depth / 2),
      },
      facing: home.rotationY,
    })),
    neighbourhoods: h.neighbourhoods.map((n) => ({
      index: n.index,
      homeCount: n.homeCount,
      centre: n.centre,
    })),
    gathering: { areas },
    bounds: h.bounds,
    roam: "box",
    frame,
    casters: h.solids.map((s) => ({ x: s.x, z: s.z, radius: Math.hypot(s.width, s.depth) / 2 })),
    solids: h.solids,
    height: h.height,
  };
}

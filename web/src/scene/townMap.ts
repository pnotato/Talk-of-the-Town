// The town as a MapLayout, so the shared camera, shadows and (later) the blob replay treat it
// like any other map. layoutTown's own output is unchanged.
import { HOME_DEPTH, TOWN_HEIGHT, TREE_RADIUS, type TownLayout } from "./layoutTown.ts";
import { type MapLayout, type Point, standingSpots } from "./mapLayout.ts";

const OUTLINE_SAMPLES = 32; // per circle, for framing
const SQUARE_SIDES = 64; // the round square as a polygon, for standing spots

export function townMap(town: TownLayout): MapLayout {
  const { square } = town;
  const circles = [square, ...town.neighbourhoods];
  const frame = circles.flatMap((d) =>
    Array.from({ length: OUTLINE_SAMPLES }, (_, i) => {
      const a = (i / OUTLINE_SAMPLES) * Math.PI * 2;
      const x = d.x + Math.cos(a) * d.radius;
      const z = d.z + Math.sin(a) * d.radius;
      return [
        { x, y: 0, z },
        { x, y: TOWN_HEIGHT, z },
      ];
    }).flat(),
  );

  const outline: Point[] = Array.from({ length: SQUARE_SIDES }, (_, i) => {
    const a = (i / SQUARE_SIDES) * Math.PI * 2;
    return { x: square.x + Math.cos(a) * square.radius, z: square.z + Math.sin(a) * square.radius };
  });

  return {
    homes: town.homes.map((h) => ({
      index: h.index,
      neighbourhood: h.neighbourhood,
      door: {
        x: h.x + Math.sin(h.rotationY) * (HOME_DEPTH / 2),
        z: h.z + Math.cos(h.rotationY) * (HOME_DEPTH / 2),
      },
      facing: h.rotationY,
    })),
    neighbourhoods: town.neighbourhoods.map((n) => ({
      index: n.index,
      homeCount: n.homeCount,
      centre: { x: n.x, z: n.z },
    })),
    gathering: {
      areas: [
        {
          name: "square",
          outline,
          spots: standingSpots(outline, [
            { kind: "disc", x: square.x, z: square.z, radius: square.fountainRadius },
          ]),
        },
      ],
    },
    bounds: town.bounds,
    roam: "ellipse",
    frame,
    casters: [
      ...circles,
      ...town.trees.map((t) => ({ x: t.x, z: t.z, radius: TREE_RADIUS * t.size })),
    ],
    height: TOWN_HEIGHT,
    // Every roof and tree is below the camera's lowest point at the town's closest zoom.
    solids: [],
  };
}

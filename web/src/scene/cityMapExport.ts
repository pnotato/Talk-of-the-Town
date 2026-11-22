// The city's walkable geometry as a file for the Go path planner (internal/sim/nav): the areas
// blobs stand on with their spots, the zebra crossings between them, and what a walking blob
// must go round. Pure: the same city always gives the same bytes, so the committed file can be
// checked for staleness with a diff.
//
// World units, x east and z south (north is -z); heights are left out.
import { type CityLayout, type CityRect, walkingObstacles } from "./layoutCity.ts";
import { BLOB_RADIUS, type Bounds, type Box, type Point, SPOT_SPACING } from "./mapLayout.ts";

/** Bumped whenever the format changes, so a reader can refuse a file it doesn't know. */
export const CITY_MAP_VERSION = 1;

// A tree further than this from every area can't get in a walking blob's way.
const TREE_REACH = 2;

// A millionth is far finer than anything a blob can tell apart, and rounding to it hides float
// noise (20.000000000000004), so the file only changes when the city does.
function num(v: number): string {
  if (!Number.isFinite(v)) throw new RangeError(`city map: ${v} is not a finite number`);
  const rounded = Math.round(v * 1e6) / 1e6;
  if (rounded === 0) return "0"; // never -0
  const text = String(rounded);
  if (/e/i.test(text)) throw new RangeError(`city map: ${v} is too big to write plainly`);
  return text;
}

const rect = (r: Bounds) =>
  `{"minX":${num(r.minX)},"maxX":${num(r.maxX)},"minZ":${num(r.minZ)},"maxZ":${num(r.maxZ)}}`;

const boundsOf = ({ x, z, width, depth }: CityRect): Bounds => ({
  minX: x - width / 2,
  maxX: x + width / 2,
  minZ: z - depth / 2,
  maxZ: z + depth / 2,
});

// The planner only knows rectangles, so an area must be one: four distinct corners of its
// bounding box, joined by straight runs along x or z.
function outlineBounds(name: string, outline: Point[]): Bounds {
  const xs = outline.map((p) => p.x);
  const zs = outline.map((p) => p.z);
  const b = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
  const corner = (p: Point) =>
    (p.x === b.minX || p.x === b.maxX) && (p.z === b.minZ || p.z === b.maxZ);
  const straight = outline.every((p, i) => {
    const q = outline[(i + 1) % outline.length];
    return p.x === q.x || p.z === q.z;
  });
  const distinct = new Set(outline.map((p) => `${p.x},${p.z}`)).size === 4;
  if (outline.length !== 4 || !distinct || !outline.every(corner) || !straight) {
    throw new Error(`city map: the ${name} area is not an axis-aligned rectangle`);
  }
  return b;
}

// A box's footprint, which must be turned by whole quarters; a quarter turn swaps its sides.
function boxBounds(b: Box): Bounds {
  const quarters = b.rotationY / (Math.PI / 2);
  const whole = Math.round(quarters);
  if (Math.abs(quarters - whole) > 1e-9) {
    throw new Error(`city map: a box turned by ${b.rotationY}, not a whole quarter`);
  }
  const [width, depth] = whole % 2 === 0 ? [b.width, b.depth] : [b.depth, b.width];
  return boundsOf({ x: b.x, z: b.z, width, depth });
}

// Clear distance from a point to a rectangle; 0 inside it.
function distanceToBounds(p: Point, b: Bounds): number {
  return Math.hypot(
    Math.max(b.minX - p.x, 0, p.x - b.maxX),
    Math.max(b.minZ - p.z, 0, p.z - b.maxZ),
  );
}

// A JSON list with one item per line.
const list = (key: string, items: string[]) =>
  `"${key}":[${items.map((item) => `\n${item}`).join(",")}\n]`;

/**
 * The city's walkable map as JSON (version 1): its areas in order, whose spots run on into the
 * standing-node ids; its crosswalks; discs (lamps, then trees near an area) and boxes
 * (buildings, then furniture) that block walking. Doorsteps are not obstacles here.
 */
export function exportCityMap(
  city: CityLayout,
  homeCount: number,
  neighbourhoodCount: number,
): string {
  if (city.homes.length !== homeCount || city.neighbourhoods.length !== neighbourhoodCount) {
    throw new RangeError(
      `city map: labelled ${homeCount} homes in ${neighbourhoodCount} neighbourhoods, but the ` +
        `city has ${city.homes.length} in ${city.neighbourhoods.length}`,
    );
  }
  const areas = city.gathering.areas.map((a) => ({
    name: a.name,
    bounds: outlineBounds(a.name, a.outline),
    spots: a.spots,
  }));
  const discs: string[] = [];
  const boxes: string[] = [];
  for (const { what, obstacle: o } of walkingObstacles(city)) {
    if (o.kind === "box") {
      boxes.push(`{"kind":${JSON.stringify(what)},"rect":${rect(boxBounds(o))}}`);
    } else if (
      what !== "tree" ||
      areas.some((a) => distanceToBounds(o, a.bounds) - o.radius <= TREE_REACH)
    ) {
      discs.push(
        `{"kind":${JSON.stringify(what)},"x":${num(o.x)},"z":${num(o.z)},"r":${num(o.radius)}}`,
      );
    }
  }
  const header =
    `{"version":${CITY_MAP_VERSION},` +
    `"layout":{"homeCount":${num(homeCount)},"neighbourhoodCount":${num(neighbourhoodCount)}},` +
    `"blobRadius":${num(BLOB_RADIUS)},"spotSpacing":${num(SPOT_SPACING)},`;
  const sections = [
    list(
      "areas",
      areas.map(
        (a) =>
          `{"name":${JSON.stringify(a.name)},"rect":${rect(a.bounds)},` +
          `"spots":[${a.spots.map((p) => `[${num(p.x)},${num(p.z)}]`).join(",")}]}`,
      ),
    ),
    list(
      "crosswalks",
      city.crosswalks.map((c) => `{"rect":${rect(boundsOf(c))},"axis":${JSON.stringify(c.axis)}}`),
    ),
    list("discs", discs),
    list("boxes", boxes),
  ];
  return `${header}\n${sections.join(",\n")}}\n`;
}

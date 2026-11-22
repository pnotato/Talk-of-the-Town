// The city's walkable geometry as a file for the Go path planner (internal/sim/nav). The format
// and writers live in walkMapExport.ts, shared with the town.
import { type CityLayout, walkingObstacles } from "./layoutCity.ts";
import { exportWalkMap, WALK_MAP_VERSION } from "./walkMapExport.ts";

/** Bumped whenever the format changes, so a reader can refuse a file it doesn't know. */
export const CITY_MAP_VERSION = WALK_MAP_VERSION;

/** The city's walkable map as JSON (version 1). */
export function exportCityMap(
  city: CityLayout,
  homeCount: number,
  neighbourhoodCount: number,
): string {
  return exportWalkMap(
    city,
    homeCount,
    neighbourhoodCount,
    city.crosswalks,
    walkingObstacles(city),
  );
}

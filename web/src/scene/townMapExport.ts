// The town's walkable geometry as a file for the Go path planner (internal/sim/nav): the same
// format as the city's map, so a run can walk either map.
import { type TownLayout } from "./layoutTown.ts";
import { townMap, townWalkObstacles } from "./townMap.ts";
import { exportWalkMap, WALK_MAP_VERSION } from "./walkMapExport.ts";

/** Bumped whenever the format changes, so a reader can refuse a file it doesn't know. */
export const TOWN_MAP_VERSION = WALK_MAP_VERSION;

/** The town's walkable map as JSON (version 1). */
export function exportTownMap(
  town: TownLayout,
  homeCount: number,
  neighbourhoodCount: number,
): string {
  return exportWalkMap(townMap(town), homeCount, neighbourhoodCount, [], townWalkObstacles(town));
}

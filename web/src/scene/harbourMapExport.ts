// The harbour's walkable geometry as a file for the Go path planner (internal/sim/nav): the same
// format as the city's and the town's, so a run can walk any of them.
import { type HarbourLayout } from "./layoutHarbour.ts";
import { harbourMap, harbourWalkObstacles } from "./harbourMap.ts";
import { exportWalkMap, WALK_MAP_VERSION } from "./walkMapExport.ts";

/** Bumped whenever the format changes, so a reader can refuse a file it doesn't know. */
export const HARBOUR_MAP_VERSION = WALK_MAP_VERSION;

/** The harbour's walkable map as JSON (version 1). */
export function exportHarbourMap(
  harbour: HarbourLayout,
  homeCount: number,
  neighbourhoodCount: number,
): string {
  return exportWalkMap(
    harbourMap(harbour),
    homeCount,
    neighbourhoodCount,
    [],
    harbourWalkObstacles(harbour),
  );
}

// Writes the town's walkable map, the one TownScene draws, for the Go path planner.
// Run from the repo root: node web/scripts/export-town-map.ts <outPath> (or: make townmap)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { layoutTown, TOWN_HOMES, TOWN_NEIGHBOURHOODS } from "../src/scene/layoutTown.ts";
import { exportTownMap } from "../src/scene/townMapExport.ts";

const [out] = process.argv.slice(2);
if (process.argv.length !== 3 || !out) {
  console.error("usage: node web/scripts/export-town-map.ts <outPath>");
  process.exit(2);
}
const town = layoutTown(TOWN_HOMES, TOWN_NEIGHBOURHOODS);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, exportTownMap(town, TOWN_HOMES, TOWN_NEIGHBOURHOODS));

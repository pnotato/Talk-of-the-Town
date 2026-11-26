// Writes the harbour's walkable map, the one HarbourScene draws, for the Go path planner.
// Run from the repo root: node web/scripts/export-harbour-map.ts <outPath> (or: make harbourmap)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  HARBOUR_HOMES,
  HARBOUR_NEIGHBOURHOODS,
  layoutHarbour,
} from "../src/scene/layoutHarbour.ts";
import { exportHarbourMap } from "../src/scene/harbourMapExport.ts";

const [out] = process.argv.slice(2);
if (process.argv.length !== 3 || !out) {
  console.error("usage: node web/scripts/export-harbour-map.ts <outPath>");
  process.exit(2);
}
const harbour = layoutHarbour(HARBOUR_HOMES, HARBOUR_NEIGHBOURHOODS);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, exportHarbourMap(harbour, HARBOUR_HOMES, HARBOUR_NEIGHBOURHOODS));

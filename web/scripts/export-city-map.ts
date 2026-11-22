// Writes the city's walkable map, the one CityScene draws, for the Go path planner.
// Run from the repo root: node web/scripts/export-city-map.ts <outPath> (or: make citymap)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exportCityMap } from "../src/scene/cityMapExport.ts";
import { CITY_HOMES, CITY_NEIGHBOURHOODS, layoutCity } from "../src/scene/layoutCity.ts";

const [out] = process.argv.slice(2);
if (process.argv.length !== 3 || !out) {
  console.error("usage: node web/scripts/export-city-map.ts <outPath>");
  process.exit(2);
}
const city = layoutCity(CITY_HOMES, CITY_NEIGHBOURHOODS);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, exportCityMap(city, CITY_HOMES, CITY_NEIGHBOURHOODS));

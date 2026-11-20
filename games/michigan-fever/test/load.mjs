// Test helper: build the route from the data files on disk (the browser uses
// loadRoute(), which fetches the same files).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRoute, DATA_FILES } from "../route.js";

const dir = fileURLToPath(new URL("../data/", import.meta.url));

export function readData() {
  return Object.fromEntries(Object.entries(DATA_FILES).map(([k, f]) => [k, JSON.parse(readFileSync(dir + f, "utf8"))]));
}

export function loadRouteFromDisk() {
  return createRoute(readData());
}

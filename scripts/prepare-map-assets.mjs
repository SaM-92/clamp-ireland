import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(await readFile(packagePath, "utf8"));
const destination = path.resolve("public", "vendor", "maplibre", version);

await mkdir(destination, { recursive: true });
// MapLibre's worker imports the shared module relative to its own URL.
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(path.join(path.dirname(packagePath), "dist", file), path.join(destination, file));
}
console.log(`Prepared MapLibre ${version} worker assets.`);

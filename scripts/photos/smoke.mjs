import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Worker } from "node:worker_threads";

const require = createRequire(path.join(process.cwd(), "package.json"));
const sharp = require("sharp");
const source = new Uint8Array(readFileSync(process.argv[2]));
const dimension = process.argv[3] === "large" ? { width: 4096, height: 4096 } : { width: 96, height: 64 };
const worker = new Worker(path.join(process.cwd(), "src", "modules", "photos", "server", "normalize-worker.mjs"), {
  workerData: { bytes: source.buffer, limits: { pixels: 64_000_000, storedBytes: 3 * 1024 * 1024, maxDimension: 4096 } },
  transferList: [source.buffer], resourceLimits: { maxOldGenerationSizeMb: 256 },
});
let timer;
try {
  const result = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Packaged photo worker exceeded 30 seconds.")), 30_000);
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", () => reject(new Error("Packaged photo worker exited before returning a result.")));
  });
  assert.equal(result.ok, true, `Packaged HEIC conversion failed: ${result.reason}`);
  assert.ok(result.bytes instanceof Uint8Array && result.bytes.byteLength <= 3 * 1024 * 1024);
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, dimension.width);
  assert.equal(metadata.height, dimension.height);
  assert.equal(metadata.exif, undefined);
  console.log(`Packaged HEIC worker passed; peak decoder process RSS ${Math.ceil(process.resourceUsage().maxRSS / 1024)} MiB.`);
} finally {
  clearTimeout(timer);
  await worker.terminate();
}

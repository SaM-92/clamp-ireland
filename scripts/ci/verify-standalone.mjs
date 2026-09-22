import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

for (const file of [
  ".next/standalone/server.js",
  ".next/static",
  "apps/admin/.next/standalone/apps/admin/server.js",
  "apps/admin/.next/static",
]) await access(file);

const manifest = JSON.parse(await readFile(".next/server/app-paths-manifest.json", "utf8"));
if (Object.keys(manifest).some((route) => /^\/(?:admin(?:\/|$)|api\/(?:admin|moderation)(?:\/|$))/.test(route))) {
  throw new Error("Public standalone build contains an administration route.");
}
console.log("Independent public/admin standalone entrypoints and public route boundary verified.");
execFileSync(process.execPath, [
  path.resolve("scripts/photos/smoke.mjs"), path.resolve("tests/fixtures/photos/synthetic.heic"),
], { cwd: path.resolve(".next/standalone"), stdio: "inherit", timeout: 45_000 });

import { access, readFile } from "node:fs/promises";

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

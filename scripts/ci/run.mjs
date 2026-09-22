import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { syntheticEnvironment } from "./environment.mjs";

const mode = process.argv[2];
const args = {
  unit: ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.unit.config.ts"],
  sql: ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.sql.config.ts"],
  smoke: ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.smoke.config.ts"],
  "build-public": ["node_modules/next/dist/bin/next", "build"],
  "build-admin": ["node_modules/next/dist/bin/next", "build", "apps/admin"],
}[mode];
if (!args) throw new Error("Expected unit, sql, smoke, build-public or build-admin.");
const env = syntheticEnvironment();
if (mode === "smoke" || mode.startsWith("build")) {
  for (const directory of [".", "apps/admin"]) {
    for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      if (existsSync(path.join(directory, file))) throw new Error("CI build/smoke refuses local environment files.");
    }
  }
}
if (!mode.startsWith("build")) {
  env.NODE_OPTIONS = `--import ${JSON.stringify(pathToFileURL(path.resolve("scripts/ci/deny-network.mjs")).href)}`;
}
if (mode === "smoke") {
  env.PLAYWRIGHT_PRODUCTION = "true";
  env.PLAYWRIGHT_ADMIN_PRODUCTION = "true";
  env.PLAYWRIGHT_CI_SMOKE = "true";
}
const child = spawn(process.execPath, [...args, ...process.argv.slice(3)], { env, stdio: "inherit" });
child.on("error", () => { console.error("Could not start CI command."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });

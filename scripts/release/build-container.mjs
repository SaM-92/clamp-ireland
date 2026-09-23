import { spawnSync } from "node:child_process";

const app = process.argv[2];
if (!["public", "admin"].includes(app)) throw new Error("Expected public or admin build.");
const profile = process.env.BUILD_PROFILE;
if (!["ci", "production"].includes(profile)) throw new Error("Explicit ci or production build profile required.");
const command = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", ...(app === "admin" ? ["apps/admin"] : [])], {
  env: process.env, stdio: "inherit",
});
if (command.error) throw new Error("Could not start container build.");
process.exitCode = command.status ?? 1;

import { execFileSync } from "node:child_process";
import { disabledAiEnvironment } from "../ci/environment.mjs";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
for (const app of ["public", "admin"]) {
  const image = process.env[`${app.toUpperCase()}_IMAGE`];
  if (!image) throw new Error(`Missing ${app} image.`);
  let id;
  try {
    const environment = { ...disabledAiEnvironment, ENABLE_AREA_SUMMARIES: "false", ENABLE_TRAFFIC_ANALYTICS: "false" };
    id = docker("run", "--detach", "--network", "none",
      ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]), image);
    docker("cp", "scripts/release/smoke.mjs", `${id}:/tmp/smoke.mjs`);
    docker("cp", "scripts/release/metadata.mjs", `${id}:/tmp/metadata.mjs`);
    docker("exec", "--env", `SMOKE_APP=${app}`, "--env", "SMOKE_ORIGIN=http://127.0.0.1:3000",
      "--env", "SMOKE_LOOPBACK=true", "--env", `RELEASE_VERSION=${process.env.RELEASE_VERSION}`,
      "--env", `RELEASE_SHA=${process.env.RELEASE_SHA}`, id, "node", "/tmp/smoke.mjs");
  } finally {
    if (id) docker("rm", "--force", id);
  }
}
console.log("Both independent container runtimes passed read-only smoke.");

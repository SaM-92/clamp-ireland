import { execFileSync } from "node:child_process";
import { disabledAiEnvironment } from "../ci/environment.mjs";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
for (const app of ["public", "admin"]) {
  const image = process.env[`${app.toUpperCase()}_IMAGE`];
  if (!image) throw new Error(`Missing ${app} image.`);
  let id;
  try {
    const environment = { ...disabledAiEnvironment, ENABLE_AREA_SUMMARIES: "false", ENABLE_TRAFFIC_ANALYTICS: "false" };
    if (app === "public") Object.assign(environment, {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon", SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
      NODE_OPTIONS: "--import=/tmp/upload-fixture.mjs --max-old-space-size=256",
    });
    id = docker("create", "--network", "none", "--cpus", app === "public" ? "1" : "0.25",
      "--memory", app === "public" ? "2g" : "512m",
      ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]), image);
    if (app === "public") docker("cp", "scripts/photos/upload-fixture.mjs", `${id}:/tmp/upload-fixture.mjs`);
    docker("start", id);
    docker("cp", "scripts/release/smoke.mjs", `${id}:/tmp/smoke.mjs`);
    docker("cp", "scripts/release/metadata.mjs", `${id}:/tmp/metadata.mjs`);
    docker("exec", "--env", `SMOKE_APP=${app}`, "--env", "SMOKE_ORIGIN=http://127.0.0.1:3000",
      "--env", "SMOKE_LOOPBACK=true", "--env", `RELEASE_VERSION=${process.env.RELEASE_VERSION}`,
      "--env", `RELEASE_SHA=${process.env.RELEASE_SHA}`, id, "node", "/tmp/smoke.mjs");
    if (app === "public") {
      docker("cp", "scripts/photos/smoke.mjs", `${id}:/tmp/photo-smoke.mjs`);
      docker("cp", "tests/fixtures/photos/64mp.heic", `${id}:/tmp/photo.heic`);
      console.log(docker("exec", id, "node", "/tmp/photo-smoke.mjs", "/tmp/photo.heic", "large"));
      docker("cp", "scripts/photos/upload-smoke.mjs", `${id}:/tmp/upload-smoke.mjs`);
      console.log(docker("exec", id, "node", "/tmp/upload-smoke.mjs"));
    }
  } finally {
    if (id) docker("rm", "--force", id);
  }
}
console.log("Both independent container runtimes passed read-only smoke.");

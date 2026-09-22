import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const app = process.argv[2];
if (!["public", "admin"].includes(app)) throw new Error("Expected public or admin build.");
const profile = process.env.BUILD_PROFILE;
if (!["ci", "production"].includes(profile)) throw new Error("Explicit ci or production build profile required.");
if (profile === "production") {
  const url = readFileSync("/run/secrets/public_supabase_url", "utf8").trim();
  const key = readFileSync("/run/secrets/public_supabase_anon_key", "utf8").trim();
  let valid = false;
  try {
    const parsed = new URL(url);
    const role = key.startsWith("sb_publishable_") ? "anon" : JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role;
    valid = parsed.protocol === "https:" && parsed.origin === url && !parsed.username && !parsed.password && role === "anon";
  } catch { valid = false; }
  if (!valid) throw new Error("Production build requires an HTTPS backend origin and a public anon/publishable key, never a service key.");
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
}
const command = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", ...(app === "admin" ? ["apps/admin"] : [])], {
  env: process.env, stdio: "inherit",
});
if (command.error) throw new Error("Could not start container build.");
process.exitCode = command.status ?? 1;

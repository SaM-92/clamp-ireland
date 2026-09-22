import type { NextConfig } from "next";
import { createRequire } from "node:module";
import path from "node:path";

// Anchor resolution explicitly: Next evaluates compiled configs in a synthetic module.
const { buildReleaseEnvironment }: typeof import("./scripts/release/metadata.mjs") =
  createRequire(path.join(__dirname, "package.json"))("./scripts/release/metadata.mjs");

const nextConfig: NextConfig = {
  output: "standalone",
  env: buildReleaseEnvironment(),
};

export default nextConfig;

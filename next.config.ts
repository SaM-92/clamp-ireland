import type { NextConfig } from "next";
import { createRequire } from "node:module";
import path from "node:path";

// Anchor resolution explicitly: Next evaluates compiled configs in a synthetic module.
const { buildReleaseEnvironment }: typeof import("./scripts/release/metadata.mjs") =
  createRequire(path.join(__dirname, "package.json"))("./scripts/release/metadata.mjs");

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp", "heic-decode"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/geographiclib-geodesic/LICENSE.txt",
      "./node_modules/openid-client/LICENSE.md",
      "./node_modules/oauth4webapi/LICENSE.md",
    ],
    "/api/reports": [
      "./src/modules/photos/server/normalize-worker.mjs",
      "./node_modules/heic-decode/**/*",
      "./node_modules/libheif-js/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
      "./node_modules/detect-libc/**/*",
      "./node_modules/semver/**/*",
    ],
  },
  env: buildReleaseEnvironment(),
};

export default nextConfig;

import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(__dirname, "../..");
// Anchor resolution explicitly: Next evaluates compiled configs in a synthetic module.
const { buildReleaseEnvironment }: typeof import("../../scripts/release/metadata.mjs") =
  createRequire(path.join(root, "package.json"))("./scripts/release/metadata.mjs");
const config: NextConfig = {
  output: "standalone",
  env: buildReleaseEnvironment(),
  turbopack: { root },
  outputFileTracingRoot: root,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    }];
  },
};
export default config;

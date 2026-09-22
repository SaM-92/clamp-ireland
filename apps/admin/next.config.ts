import type { NextConfig } from "next";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const config: NextConfig = {
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

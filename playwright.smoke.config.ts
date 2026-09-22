import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["release-smoke.spec.ts", "admin-isolation.spec.ts"],
  outputDir: "test-results/smoke",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["junit", { outputFile: "test-results/smoke.xml" }],
    ["html", { outputFolder: "playwright-report", open: "never" }]],
  webServer: [
    {
      command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3015",
      url: "http://127.0.0.1:3015/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "node tests/helpers/admin-test-server.mjs",
      url: "http://127.0.0.1:3016/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:3015",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
});

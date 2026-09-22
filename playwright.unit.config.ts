import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results/unit",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["junit", { outputFile: "test-results/unit.xml" }]],
  projects: [
    {
      name: "unit-server",
      testMatch: /.*-(contract|runtime|server|unit|access)\.spec\.ts/,
      testIgnore: "**/traffic-server.spec.ts",
    },
    {
      name: "traffic-unit-server",
      testMatch: "**/traffic-server.spec.ts",
      grepInvert: /standalone traffic migration|traffic table renders/,
    },
    { name: "seo-unit", testMatch: "**/seo.spec.ts", grep: /SEO policy/ },
  ],
});

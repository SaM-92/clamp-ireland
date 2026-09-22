import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /content-policy-(unit|runtime|database)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  outputDir: "../test-results/content-policy",
});

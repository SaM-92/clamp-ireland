import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results/sql",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["junit", { outputFile: "test-results/sql.xml" }]],
  projects: [
    { name: "sql-policy", testMatch: ["**/*-policy.spec.ts", "**/*-database.spec.ts"] },
    { name: "traffic-sql", testMatch: "**/traffic-server.spec.ts", grep: /standalone traffic migration/ },
  ],
});

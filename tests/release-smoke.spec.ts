import { expect, test } from "./helpers/ci-browser";
import { readFileSync } from "node:fs";
import { adminUrl } from "./helpers/admin";

test.skip(process.env.PLAYWRIGHT_PRODUCTION !== "true", "Requires the isolated production smoke configuration");

test("production health is minimal and identifies the actual public build", async ({ request }) => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", version, sha: process.env.APP_RELEASE_SHA ?? "local" });
  expect(response.headers()["cache-control"]).toContain("no-store");
  const admin = await request.get(adminUrl("/api/health"));
  expect(admin.status()).toBe(200);
  expect(await admin.json()).toEqual({ status: "ok" });
});

test("production public pages render without preview and admin remains a separate sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".preview-banner")).toHaveCount(0);
  await page.goto("/appeal");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto(adminUrl("/admin"));
  await expect(page).toHaveURL(adminUrl("/auth/sign-in"));
  await expect(page.getByRole("heading", { name: "Community overview" })).toHaveCount(0);
});

test("production never exposes the development AI demo page or inference API", async ({ request }) => {
  for (const path of ["/dev/ai-demo", "/api/dev/ai-demo"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  expect((await request.post("/api/dev/ai-demo", { data: {} })).status()).toBe(404);
});

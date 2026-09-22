import { expect, test } from "@playwright/test";

test("traffic reads stay protected and local collection is clearly disabled", async ({ request }) => {
  expect((await request.get("/api/admin/traffic")).status()).toBe(403);
  test.skip(process.env.PLAYWRIGHT_PRODUCTION === "true", "Production collection depends on deployment opt-in.");
  const response = await request.post("/api/analytics/pageview", { data: { route: "/", viewport: "mobile" } });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ enabled: false, reason: "Analytics not enabled" });
});

test("375px local dashboard explains disabled analytics with no fake traffic counts or collection", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION === "true", "Local preview only.");
  await page.setViewportSize({ width: 375, height: 812 });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(analytics|admin\/traffic)/.test(request.url())) requests.push(request.url());
  });
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Pageviews (approximate)" });
  await expect(panel.getByText("Analytics not enabled", { exact: true })).toBeVisible();
  await expect(panel).toContainText("Cookie-free is not a compliance guarantee");
  await expect(panel).toContainText("not billing-grade");
  await expect(panel.getByRole("definition")).toHaveCount(0);
  await expect(panel.getByRole("table")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests).toEqual([]);
});

test("traffic dashboard shows actual daily totals and explicit disabled/error states at 375px", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION !== "true", "Run against existing preview-disabled production server.");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/admin/overview", (route) => route.fulfill({ json: {
    pending: 0, published: 2, rejected: 1, totalReports: 3, totalUsers: 2,
  } }));
  await page.route("**/api/moderation/reports", (route) => route.fulfill({ json: [] }));
  let mode: "enabled" | "disabled" | "error" = "enabled";
  await page.route("**/api/admin/traffic", (route) => route.fulfill(mode === "error"
    ? { status: 500, json: { error: "Traffic unavailable" } }
    : { json: mode === "disabled" ? { enabled: false, reason: "Analytics not enabled" } : {
      enabled: true, from: "2026-08-24", through: "2026-09-22", totalPageviews: 17, mobilePageviews: 6,
      days: [{ day: "2026-09-22", pageviews: 12, mobilePageviews: 4 }, { day: "2026-09-21", pageviews: 5, mobilePageviews: 2 }],
    } }));
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Pageviews (approximate)", exact: true });
  await expect(panel.getByRole("definition")).toHaveText(["17", "6"]);
  await expect(panel.getByRole("row")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mode = "error";
  await panel.getByRole("button", { name: "Refresh traffic" }).click();
  await expect(panel.getByRole("alert")).toContainText("Could not load traffic totals");
  await expect(panel.getByRole("definition")).toHaveCount(0);
  mode = "disabled";
  await panel.getByRole("button", { name: "Refresh traffic" }).click();
  await expect(panel.getByText("Analytics not enabled", { exact: true })).toBeVisible();
  await expect(panel.getByRole("definition")).toHaveCount(0);
});

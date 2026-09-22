import { expect, test } from "@playwright/test";
import { expectStreetDetail } from "./helpers/map";

test("loads the street map and its module worker", async ({ page }) => {
  const errors: string[] = [];
  const workerUrls: string[] = [];
  const tiles: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("response", (response) => {
    if (/\/planet\/.*\.pbf$/.test(response.url()) && response.ok()) tiles.push(response.url());
  });

  await page.goto("/");
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect.poll(() => tiles.length, {
    message: "Street tiles must load; errors: " + errors.join("\n"),
    timeout: 30_000,
  }).toBeGreaterThan(0);
  expect(workerUrls.some((url) => /\/vendor\/maplibre\/[\d.]+\/maplibre-gl-worker\.mjs$/.test(url))).toBe(true);
  const worker = await page.request.get(workerUrls[0]);
  expect(worker.headers()["content-type"]).toMatch(/javascript/);
  const bounds = await page.locator(".map-canvas").boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(400);
  await expectStreetDetail(page);
  await page.locator(".maplibregl-canvas").screenshot({ path: test.info().outputPath("streets.png") });
  expect(errors).toEqual([]);
});

test("local preview saves reports without authentication or backend writes", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION === "true", "Local preview is development-only.");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByText("Local preview", { exact: true })).toBeVisible();
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add a report", exact: true }).click();
  await page.getByRole("button", { name: "Use map centre" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("What happened?", { exact: false }).fill("Testing the local preview; no real incident.");
  await page.getByRole("button", { name: "Save preview report" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".report-marker")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("this browser only");
  await page.reload();
  await expect(page.locator(".report-marker")).toHaveCount(1, { timeout: 30_000 });
  await page.locator(".report-marker").click();
  await expect(page.locator(".map-popup")).toContainText("Preview: 1 community report");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".report-marker").press("Enter");
  await expect(page.locator(".map-popup")).toHaveCount(0);
  await page.locator(".report-marker").press("Space");
  await expect(page.locator(".map-popup")).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Reset preview" }).click();
  await expect(page.locator(".report-marker")).toHaveCount(0);
});

test("phone and landscape layouts keep the street map and form usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto("/");
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath("phone.png"), fullPage: true });
  for (const viewport of [{ width: 375, height: 850 }, { width: 768, height: 1024 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator(".map-canvas").boundingBox())?.height).toBeGreaterThanOrEqual(400);
  }
  await page.getByRole("button", { name: "Add a report", exact: true }).click();
  await page.getByRole("button", { name: "Use map centre" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "I am reporting as" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("map failure displays a useful error and Retry reloads the streets", async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/styles/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".map-feedback[role=alert]")).toContainText("Map unavailable", { timeout: 20_000 });
  await page.unroute("https://tiles.openfreemap.org/styles/**");
  await page.getByRole("button", { name: "Retry map" }).click();
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({ timeout: 30_000 });
});

test("city navigation, geolocation, and sign-in are available without a blank screen", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 53.3498, longitude: -6.2603 });
  await page.goto("/");
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole("combobox", { name: "Jump to city" }).selectOption("Cork");
  await expect(page.getByRole("combobox", { name: "Jump to city" })).toHaveValue("Cork");
  await page.getByRole("button", { name: "My location", exact: true }).click();
  await expect(page.locator(".maplibregl-user-location-dot")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create account", exact: true }).first().click();
  await expect(page.locator('input[autocomplete="new-password"]')).toBeVisible();
});

test("public API does not accept unauthenticated preview writes", async ({ request }) => {
  const response = await request.post("/api/reports", { multipart: { description: "A test, not a real report." } });
  expect(response.status()).toBe(401);
});

test("production never offers the local auth-free preview", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION !== "true", "Production-only guard check.");
  await page.goto("/");
  await expect(page.getByText("Local preview", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add a report", exact: true }).click();
  await page.getByRole("button", { name: "Use map centre" }).click();
  await page.getByLabel("What happened?", { exact: false }).fill("This is a test.");
  await page.getByRole("button", { name: "Submit report", exact: true }).click();
  await expect(page.locator(".form-error[role=alert]")).toContainText("Sign in to publish");
});

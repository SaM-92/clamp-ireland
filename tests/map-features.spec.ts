import { expect, test } from "@playwright/test";
import { createReportZones, ZONE_OPACITY, ZONE_RADIUS_METRES } from "../src/modules/map/lib/reportZones";
import { parsePlaces } from "../src/modules/map/lib/searchPlaces";

test("zone polygons stay at 100 metres with 50 percent opacity", () => {
  expect(ZONE_RADIUS_METRES).toBe(100);
  expect(ZONE_OPACITY).toBe(0.5);
  const zones = createReportZones([{ id: "spot", lat: 53.2158, lng: -6.6669, reportCount: 3, riskLevel: "high", riskScore: 51.32 }]);
  const ring = zones.features[0].geometry.coordinates[0];
  expect(ring).toHaveLength(65);
  expect(ring[0]).toEqual(ring.at(-1));
  expect(zones.features[0].properties?.riskLevel).toBe("high");
  for (const [lng, lat] of ring) {
    const toRad = Math.PI / 180;
    const a = Math.sin((lat - 53.2158) * toRad / 2) ** 2 +
      Math.cos(lat * toRad) * Math.cos(53.2158 * toRad) * Math.sin((lng + 6.6669) * toRad / 2) ** 2;
    expect(2 * 6_371_008.8 * Math.asin(Math.sqrt(a))).toBeCloseTo(100, 4);
  }
  expect(createReportZones([]).features).toHaveLength(0);
  expect(createReportZones([{ id: "empty", lat: 53.2, lng: -6.6, reportCount: 0, riskScore: 0, riskLevel: "low" }]).features).toHaveLength(0);
});

test("geocoder results exclude places outside the island", () => {
  const feature = (name: string, countrycode: string, state: string, coordinates: number[]) => ({
    type: "Feature", geometry: { type: "Point", coordinates },
    properties: { osm_type: "N", osm_id: name, name, countrycode, state, type: "city" },
  });
  const places = parsePlaces({ features: [
    feature("Naas", "IE", "Leinster", [-6.6669, 53.2158]),
    feature("Belfast", "GB", "Northern Ireland", [-5.9301, 54.5973]),
    feature("Outside", "IE", "", [20, 10]),
    feature("Wales", "GB", "Wales", [-5.35, 51.85]),
  ] });
  expect(places.map((place) => place.name)).toEqual(["Naas", "Belfast"]);
  expect(() => parsePlaces({ features: [{ geometry: null }] })).toThrow();
});

test("search runs on submission and supports keyboard result selection", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/places?*", (route) => {
    calls++;
    return route.fulfill({ json: [{ id: "street", name: "North Main Street", address: "Naas, County Kildare", lat: 53.2188, lng: -6.6627, zoom: 16 }] });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Jump to city" }).selectOption("Naas");
  await page.getByRole("searchbox", { name: "Search towns or streets in Ireland" }).fill("Main Street Naas");
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const result = page.getByRole("button", { name: "North Main Street Naas, County Kildare" });
  await expect(result).toBeVisible();
  await result.focus();
  await page.keyboard.press("Enter");
  await expect(result).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Jump to city" })).toHaveValue("");
  expect(calls).toBe(1);
});

test("search failure has an actionable message", async ({ page }) => {
  await page.route("**/api/places?*", (route) => route.fulfill({ status: 502, json: { error: "Place search is unavailable right now. Try the city list." } }));
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search towns or streets in Ireland" }).fill("Naas");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".search-results [role=alert]")).toContainText("Try the city list");
});

test("empty search gives guidance and editing cancels stale results", async ({ page }) => {
  await page.route("**/api/places?*", async (route) => {
    if (route.request().url().includes("slow")) await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("searchbox").fill("unknown street");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".search-results")).toContainText("Try adding the town or county");
  await page.getByRole("searchbox").fill("slow street");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill("another street");
  await expect(page.locator(".search-results")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeEnabled();
});

test("pins show local notes and three recent personal reports make a high-signal zone", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION === "true", "Development-only preview.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole("combobox", { name: "Jump to city" }).selectOption("Naas");
  await page.getByRole("button", { name: "Add a report", exact: true }).click();
  await page.getByRole("button", { name: "Use map centre" }).click();
  await page.getByLabel("What happened?", { exact: false }).fill("Preview only: a clamping report near this street.");
  await page.getByRole("button", { name: "Save preview report" }).click();
  await expect(page.locator(".report-marker.risk-medium")).toHaveCount(1);
  for (let index = 0; index < 2; index++) {
    await page.locator(".location-card").click();
    await expect(page.getByRole("dialog", { name: "Reports at this spot" })).toContainText("Preview only: a clamping report");
    await page.getByRole("button", { name: "Add a report here" }).click();
    await page.getByLabel("What happened?", { exact: false }).fill(`Another local test note ${index + 1}.`);
    await page.getByRole("button", { name: "Save preview report" }).click();
  }
  await expect(page.locator(".report-marker.risk-high")).toHaveCount(1);
  await expect(page.locator(".report-marker")).toHaveText("3");
  await page.locator(".report-marker").click();
  await page.getByRole("button", { name: "View notes", exact: true }).click();
  await expect(page.locator(".public-notes li")).toHaveCount(3);
  await page.getByRole("button", { name: "Close location notes" }).click();
  const marker = await page.locator(".report-marker").boundingBox();
  const canvas = await page.locator(".map-canvas").boundingBox();
  const zonePoint = { x: marker!.x + marker!.width / 2 + 60 - canvas!.x, y: marker!.y + marker!.height / 2 - canvas!.y };
  await page.locator(".map-canvas").click({ position: zonePoint });
  await expect(page.getByRole("dialog", { name: "Reports at this spot" })).toBeVisible();
  await page.getByRole("button", { name: "Close location notes" }).click();
  await page.getByRole("button", { name: "Add a report", exact: true }).click();
  await page.locator(".map-canvas").click({ position: zonePoint });
  await expect(page.getByRole("dialog", { name: "Share what happened." })).toBeVisible();
  await page.getByRole("button", { name: "Close report form" }).click();
  await page.getByRole("checkbox", { name: "Show zones" }).uncheck();
  await expect(page.getByRole("checkbox", { name: "Show zones" })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Show zones" }).check();
  await page.screenshot({ path: test.info().outputPath("naas-reports-zone.png"), fullPage: true });
});

test("public notes validate location identifiers", async ({ request }) => {
  expect((await request.get("/api/locations/not-a-uuid/reports")).status()).toBe(400);
  const response = await request.get("/api/locations/00000000-0000-4000-8000-000000000001/reports");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual([]);
});

test("actual Ireland geocoder finds a Naas street", async ({ request }) => {
  const response = await request.get("/api/places?q=Main%20Street%20Naas");
  expect(response.ok()).toBe(true);
  const results = await response.json();
  expect(results.some((place: { name: string }) => /main street/i.test(place.name))).toBe(true);
  const invalid = await request.get("/api/places?q=x");
  expect(invalid.status()).toBe(400);
});

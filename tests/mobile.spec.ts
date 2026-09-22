import { expect, test } from "@playwright/test";
import { expectStreetDetail } from "./helpers/map";

for (const width of [320, 375, 390, 430]) {
  test(`touch phone ${width}px supports search, zones, notes and report entry`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL, viewport: { width, height: 844 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.route("**/api/places?*", (route) => route.fulfill({ json: [{
        id: "naas-street", name: "Main Street South", address: "Naas, County Kildare",
        lat: 53.2158, lng: -6.6669, zoom: 16,
      }] }));
      await page.goto("/");
      await expect(page.locator('[data-map-state="ready"]')).toBeVisible({ timeout: 30_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const mapBox = await page.locator(".map-view").boundingBox();
      const sidebarBox = await page.locator(".map-sidebar").boundingBox();
      expect(mapBox!.y).toBeLessThan(sidebarBox!.y);
      expect(mapBox!.y).toBeLessThan(620);
      expect(await page.getByRole("searchbox").evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
      await page.getByRole("searchbox").fill("Main Street Naas");
      await page.getByRole("button", { name: "Search", exact: true }).tap();
      await page.getByRole("button", { name: "Main Street South Naas, County Kildare" }).tap();
      await page.getByRole("button", { name: "Add a report", exact: true }).tap();
      await page.getByRole("button", { name: "Use map centre" }).tap();
      await page.setViewportSize({ width, height: 360 });
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(330);
      const note = 'Mobile preview <img src=x onerror="window.__noteExecuted=true"> ' + "long-note-".repeat(40);
      await page.getByLabel("What happened?", { exact: false }).fill(note);
      if (process.env.PLAYWRIGHT_PRODUCTION === "true") {
        await page.getByRole("button", { name: "Submit report", exact: true }).tap();
        await expect(page.locator(".form-error")).toContainText("Sign in");
        await page.getByRole("button", { name: "Cancel", exact: true }).tap();
      } else {
        await page.getByRole("button", { name: "Save preview report" }).tap();
        await page.setViewportSize({ width, height: 844 });
        await page.locator(".report-marker").tap();
        await page.getByRole("button", { name: "View notes", exact: true }).tap();
        await expect(page.locator(".public-notes p")).toHaveText(note);
        expect(await page.evaluate(() => "__noteExecuted" in window)).toBe(false);
        expect(await page.locator(".notes-dialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.getByRole("button", { name: "Close location notes" }).tap();
        await expect(page.getByRole("button", { name: "View notes", exact: true })).toBeFocused();
        await page.reload();
        await page.locator(".location-card").tap();
        await expect(page.locator(".public-notes p")).toHaveText(note);
        await page.getByRole("button", { name: "Close location notes" }).tap();
      }
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("checkbox", { name: "Show zones" }).uncheck();
      await page.getByRole("checkbox", { name: "Show zones" }).check();
      await page.locator(".place-search").scrollIntoViewIfNeeded();
      await expectStreetDetail(page);
      await page.screenshot({ path: test.info().outputPath(`phone-${width}.png`), fullPage: true });
      await page.setViewportSize({ width: 844, height: 390 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
    }
  });
}

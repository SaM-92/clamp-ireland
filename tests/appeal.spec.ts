import { expect, test } from "@playwright/test";

test.describe("public clamping appeal guide", () => {
  test.use({ javaScriptEnabled: false });

  test("renders useful content and metadata without JavaScript or sign-in", async ({ page }) => {
    const response = await page.goto("/appeal");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Clamping appeal guide | Clamp Transparency Signal");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Republic of Ireland.*60\/21\/30-day/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clamping appeal guide");
    await expect(page.locator('time[datetime="2026-09-22"]')).toHaveText("22 September 2026");
    await expect(page.getByRole("link", { name: "Back to community map" })).toHaveAttribute("href", "/");
  });

  test("explains deadline triggers, stage-one prerequisite and required documents", async ({ page }) => {
    await page.goto("/appeal");
    const stageOne = page.getByRole("region", { name: "Appeal to the parking controller first" });
    await expect(stageOne).toContainText("60 days of the clamping or relocation");
    await expect(stageOne).toContainText("21 days of receiving your appeal");
    await expect(stageOne).toContainText("clamp notice or release-fee receipt");
    const stageTwo = page.getByRole("region", { name: "Still dissatisfied? Apply to the NTA" });
    await expect(stageTwo).toContainText("You must complete stage 1 before applying to the NTA.");
    await expect(stageTwo).toContainText("30 days of receiving that decision");
    await expect(stageTwo).toContainText("person who was in charge of the vehicle");
    await expect(stageTwo).toContainText("copy of the first-stage Letter of Determination");
    await expect(stageTwo).toContainText("independent appeals officer");
    await expect(stageTwo).toContainText("allowed or not allowed");
  });

  test("distinguishes scope, complaints, fines and private evidence", async ({ page }) => {
    await page.goto("/appeal");
    const scope = page.getByRole("complementary", { name: "Know the scope" });
    await expect(scope).toContainText("Republic of Ireland only");
    await expect(scope).toContainText("procedures do not apply in Northern Ireland");
    await expect(scope).toContainText("not an NTA service or NTA-endorsed guidance");
    await expect(scope).toContainText("not legal advice");
    await expect(scope).toContainText("does not guarantee a refund");
    const complaints = page.getByRole("region", { name: "A complaint is a separate process" });
    await expect(complaints).toContainText("60 days of the event");
    await expect(complaints).toContainText("Do not substitute a complaint for an appeal");
    await expect(page.getByRole("region", { name: "Parking fine appeals are different" })).toContainText("not a parking fine appeal process");
    await expect(page.getByRole("region", { name: "Evidence to keep privately" })).toContainText("not in a public community note");
    await expect(page.getByRole("region", { name: "Three timings to keep in view" })).toContainText("does not submit an appeal or stop, pause or extend an appeal deadline");
  });

  test("links directly to official guidance and forms", async ({ page }) => {
    await page.goto("/appeal");
    await expect(page.getByRole("link", { name: "Open the official NTA appeal form", exact: true })).toHaveAttribute("href", "https://clampingregulation.nationaltransport.ie/appeal");
    await expect(page.getByRole("link", { name: "Open the official NTA complaint form", exact: true })).toHaveAttribute("href", "https://clampingregulation.nationaltransport.ie/complaint");
    await expect(page.getByRole("link", { name: "Read the NTA vehicle clamping regulation guidance" })).toHaveAttribute("href", "https://www.nationaltransport.ie/vehicle-clamping-regulation/");
    await expect(page.locator("main form")).toHaveCount(0);
  });

  for (const width of [320, 375, 768]) {
    test(`fits ${width}px with touch-sized links and keyboard access`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/appeal");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const link of await page.locator("main a").all()) {
        const box = await link.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Back to community map" })).toBeFocused();
    });
  }
});

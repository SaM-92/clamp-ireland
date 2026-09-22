import { expect, test } from "@playwright/test";

const reportId = "10000000-0000-4000-8000-000000000001";
const locationId = "30000000-0000-4000-8000-000000000001";
const reportKey = "clamp-local-preview-v1";
const voteKey = "clamp-local-preview-votes-v1";
const report = {
  id: reportId, lat: 53.2158, lng: -6.6669, reporterType: "witness", hasImage: false,
  createdAt: "2026-09-22T10:00:00Z", incidentDate: null,
  description: "Preview feedback fixture, not a real incident.",
};
const publicNote = {
  id: reportId, reporterType: "witness", createdAt: report.createdAt,
  incidentDate: null, description: "Reviewed fixture, not a real incident.",
  voteCounts: { agreeCount: 3, disagreeCount: 2 },
};

test.use({ hasTouch: true, isMobile: true, reducedMotion: "reduce" });

for (const width of [320, 375, 430]) {
  test(`${width}px real notes dialog supports preview feedback, persistence and full reset`, async ({ page }) => {
    test.skip(process.env.PLAYWRIGHT_PRODUCTION === "true", "Browser-local preview is development-only.");
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(({ key, report }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify([report]));
    }, { key: reportKey, report });
    const backendVotes: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/report-votes")) backendVotes.push(request.url());
    });
    await page.goto("/");
    const card = page.locator(".location-card");
    await expect(card).toHaveCount(1);
    const stats = await page.locator(".signal-stats").innerText();
    const original = await page.evaluate((key) => localStorage.getItem(key), reportKey);
    await card.tap();
    const dialog = page.getByRole("dialog", { name: "Reports at this spot" });
    const agree = dialog.getByRole("button", { name: /^Agreed/ });
    const disagree = dialog.getByRole("button", { name: /^Disagreed/ });
    await expect(dialog.locator(".public-notes li > p")).toHaveText(report.description);
    await expect(dialog.getByRole("region", { name: "Nearby reports summary" })).toBeVisible();
    await expect(agree).toBeEnabled();
    await agree.tap();
    await expect(agree).toHaveText("Agreed 1");
    await expect(agree).toHaveAttribute("aria-pressed", "true");
    await disagree.tap();
    await expect(agree).toHaveText("Agreed 0");
    await expect(disagree).toHaveText("Disagreed 1");
    await disagree.tap();
    await expect(disagree).toHaveText("Disagreed 0");
    await agree.focus();
    await page.keyboard.press("Space");
    await expect(agree).toHaveAttribute("aria-pressed", "true");
    for (const button of [agree, disagree]) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate((key) => localStorage.getItem(key), reportKey)).toBe(original);
    await page.screenshot({ path: test.info().outputPath(`note-feedback-${width}.png`) });
    await dialog.getByRole("button", { name: "Close location notes" }).tap();
    await expect(card).toBeFocused();
    expect(await page.locator(".signal-stats").innerText()).toBe(stats);
    await page.reload();
    await card.tap();
    await expect(agree).toHaveText("Agreed 1");
    await expect(agree).toHaveAttribute("aria-pressed", "true");
    await page.setViewportSize({ width: 844, height: 390 });
    await disagree.focus();
    await page.keyboard.press("Enter");
    await expect(disagree).toHaveAttribute("aria-pressed", "true");
    const buttonBounds = await disagree.boundingBox();
    const dialogBounds = await dialog.boundingBox();
    expect(buttonBounds!.y).toBeGreaterThanOrEqual(dialogBounds!.y);
    expect(buttonBounds!.y + buttonBounds!.height).toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: "Close location notes" }).tap();
    await page.getByRole("button", { name: "Reset preview", exact: true }).tap();
    await expect(card).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), voteKey)).toBeNull();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), reportKey)).toEqual([]);
    expect(backendVotes).toEqual([]);
  });
}

test("real preview reset recovers corrupt votes and reports storage failures honestly", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION === "true", "Browser-local preview is development-only.");
  await page.addInitScript(({ reportKey, voteKey, report }) => {
    localStorage.setItem(reportKey, JSON.stringify([report]));
    localStorage.setItem(voteKey, "invalid-json");
  }, { reportKey, voteKey, report });
  await page.goto("/");
  await page.locator(".location-card").click();
  const dialog = page.getByRole("dialog", { name: "Reports at this spot" });
  await expect(dialog.getByRole("alert")).toContainText("Saved preview votes are invalid");
  await expect(dialog.getByRole("button", { name: /^Agreed/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close location notes" }).click();
  await page.evaluate((key) => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (name) {
      if (name === key) throw new Error("Fixture blocked storage");
      remove.call(this, name);
    };
  }, voteKey);
  await page.getByRole("button", { name: "Reset preview", exact: true }).click();
  await expect(page.locator(".notice")).toContainText("Could not completely clear preview storage");
  await expect(page.locator(".location-card")).toHaveCount(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), voteKey)).toBe("invalid-json");
  await page.reload();
  await page.getByRole("button", { name: "Reset preview", exact: true }).click();
  await expect(page.locator(".location-card")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), voteKey)).toBeNull();
});

test("production notes expose counts but require sign-in and never invent missing counts", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION !== "true", "Requires a preview-disabled production server.");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/locations", (route) => route.fulfill({ json: [{
    id: locationId, lat: report.lat, lng: report.lng, reportCount: 1, riskScore: 10, riskLevel: "low",
  }] }));
  let countsAvailable = true;
  await page.route(`**/api/locations/${locationId}/reports`, (route) => route.fulfill({
    json: [{ ...publicNote, voteCounts: countsAvailable ? publicNote.voteCounts : undefined }],
  }));
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) writes.push(request.url());
  });
  await page.goto("/");
  await page.locator(".location-card").tap();
  const dialog = page.getByRole("dialog", { name: "Reports at this spot" });
  await expect(dialog.getByRole("button", { name: "Agreed 3", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Disagreed 2", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Sign in to vote" })).toHaveAttribute("href", "/auth/sign-in");
  await expect(dialog.locator(".public-notes li > p")).toHaveText(publicNote.description);
  await expect(dialog.getByText(/not proof/)).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Close location notes" }).tap();
  countsAvailable = false;
  await page.locator(".location-card").tap();
  await expect(dialog.getByRole("alert")).toContainText("Feedback counts are unavailable");
  await expect(dialog.getByRole("button", { name: /^Agreed/ })).toHaveCount(0);
  expect(writes).toEqual([]);
});

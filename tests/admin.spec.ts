import { expect, test, type Page } from "@playwright/test";
import { adminBaseURL, authorizeAdmin } from "./helpers/admin";
import { CONTENT_LIMITS } from "../src/modules/content-policy/policy";

test.use({ baseURL: adminBaseURL });

const id = "00000000-0000-4000-8000-000000000001";
const locationId = "00000000-0000-4000-8000-000000000002";
const localReport = {
  id, lat: 53.2158, lng: -6.6669, reporterType: "witness", hasImage: true,
  createdAt: "2026-09-22T10:00:00Z", description: "Browser-only test note, not a real incident.", incidentDate: "2026-09-21",
};
const pendingReport = {
  id, locationId, reporterType: "witness", description: "Private wording for review",
  createdAt: "2026-09-22T10:00:00Z", hasImage: false, imageUrl: null, imageError: null,
};

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("admin API and moderation reject unauthenticated requests, even with preview flags", async ({ request }) => {
  for (const url of ["/api/admin/overview", "/api/admin/overview?preview=true", "/api/moderation/reports"]) {
    const response = await request.get(url);
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  }
  const decision = await request.patch(`/api/moderation/reports/${id}`, { data: { action: "approve", description: "Denied", reviewed: true } });
  expect(decision.status()).toBe(403);
});

test("shared admin navigation includes summary review and fits a 320px phone", async ({ page }) => {
  await authorizeAdmin(page);
  await page.setViewportSize({ width: 320, height: 812 });
  for (const [path, label] of [
    ["/admin", "Overview"],
    ["/admin/moderation", "Moderation queue"],
    ["/admin/summaries", "Area summaries"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Area summaries", exact: true })).toHaveAttribute("href", "/admin/summaries");
    await expect(page.getByRole("link", { name: "Back to map", exact: true })).toHaveCount(0);
    await noOverflow(page);
  }
});

test("private pages never expose a local dashboard or bypass sign-in through browser data", async ({ page }) => {
  await page.addInitScript((report) => localStorage.setItem("clamp-local-preview-v1", JSON.stringify([report])), localReport);
  for (const path of ["/admin?preview=true", "/admin/moderation", "/admin/summaries"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Administrator sign-in" })).toBeVisible();
    await expect(page.getByText(localReport.description)).toHaveCount(0);
    await expect(page.getByRole("definition")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /register|create account/i })).toHaveCount(0);
  }
});

test("live overview shows real API counts and refreshes after a mocked review", async ({ page }) => {
  await authorizeAdmin(page);
  let approved = false;
  await page.route("**/api/admin/overview", (route) => route.fulfill({ json: {
    pending: approved ? 0 : 1, published: approved ? 8 : 7, rejected: 2, totalReports: 10, totalUsers: 4,
  } }));
  await page.route("**/api/moderation/reports", (route) => route.fulfill({ json: [pendingReport] }));
  await page.route(`**/api/moderation/reports/${id}`, (route) => { approved = true; return route.fulfill({ json: { id } }); });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin");
  await expect(page.getByRole("definition")).toHaveText(["1", "7", "2", "10", "4"]);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve & publish" }).click();
  await expect(page.getByRole("definition")).toHaveText(["0", "8", "2", "10", "4"]);
  await noOverflow(page);
  await page.route("**/api/admin/overview", (route) => route.fulfill({ status: 500, json: { error: "Database failed" } }));
  await page.getByRole("button", { name: "Refresh overview" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load");
  await expect(page.getByRole("definition")).toHaveCount(0);
});

test("moderation offers sign-in guidance without leaking a queue", async ({ page }) => {
  await page.goto("/admin/moderation");
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Administrator sign-in" })).toBeVisible();
  await expect(page.getByLabel("Public note after review")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("375px review supports editing, confirmation reset, approval, rejection and keyboard access", async ({ page }) => {
  await authorizeAdmin(page);
  await page.setViewportSize({ width: 375, height: 812 });
  const decisions: unknown[] = [];
  await page.route("**/api/moderation/reports", (route) => route.fulfill({ json: [
    { ...pendingReport, description: "A".repeat(CONTENT_LIMITS.report_note) },
    { ...pendingReport, id: locationId, description: "Second report" },
  ] }));
  await page.route(/\/api\/moderation\/reports\/[^/]+$/, (route) => {
    decisions.push(route.request().postDataJSON());
    return route.fulfill({ json: { id } });
  });
  await page.goto("/admin/moderation");
  const first = page.getByRole("listitem").first();
  await expect(first.getByRole("button", { name: "Approve & publish" })).toBeDisabled();
  await first.getByRole("checkbox").check();
  await first.getByRole("textbox").fill("Reviewed factual wording.");
  await expect(first.getByRole("checkbox")).not.toBeChecked();
  await first.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await expect(first.getByRole("button", { name: "Approve & publish" })).toBeEnabled();
  await noOverflow(page);
  expect((await first.getByRole("button", { name: "Approve & publish" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await first.getByRole("button", { name: "Approve & publish" }).click();
  await expect(page.getByRole("status")).toContainText("approved and published");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("No reports waiting for review.")).toBeVisible();
  expect(decisions).toEqual([
    { action: "approve", description: "Reviewed factual wording.", reviewed: true },
    { action: "reject" },
  ]);
});

test("photo signing and image load failures block approval; reload recovers safely", async ({ page }) => {
  await authorizeAdmin(page);
  await page.setViewportSize({ width: 375, height: 812 });
  let signingFailed = true;
  let imageFailed = true;
  const photo = "http://localhost/private-evidence-test.svg";
  await page.route("**/api/moderation/reports", (route) => route.fulfill({ json: [{
    ...pendingReport, hasImage: true, imageUrl: signingFailed ? null : photo,
    imageError: signingFailed ? "Private photo could not be signed. Approval is blocked." : null,
  }] }));
  await page.route(photo, (route) => imageFailed
    ? route.fulfill({ status: 403, body: "Expired" })
    : route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#0369a1"/></svg>' }));
  await page.goto("/admin/moderation");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be signed");
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approve & publish" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeEnabled();
  signingFailed = false;
  await page.getByRole("button", { name: "Reload queue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("failed to load or expired");
  await expect(page.getByRole("checkbox")).toBeDisabled();
  imageFailed = false;
  await page.getByRole("button", { name: "Reload queue" }).click();
  await expect(page.getByRole("checkbox")).toBeEnabled();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Approve & publish" })).toBeEnabled();
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath("admin-private-review-375.png"), fullPage: true });
});

test("queue and decision errors are explicit, retryable and retain unsaved wording", async ({ page }) => {
  await authorizeAdmin(page);
  let failed = true;
  await page.route("**/api/moderation/reports", (route) => route.fulfill(failed
    ? { status: 500, json: { error: "offline" } }
    : { json: [pendingReport] }));
  await page.route(`**/api/moderation/reports/${id}`, (route) => route.fulfill({ status: 500, json: { error: "Storage unavailable" } }));
  await page.goto("/admin/moderation");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load the queue");
  await expect(page.getByText("No reports waiting for review.")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Reload queue" }).click();
  await page.getByRole("textbox").fill("Keep my unsaved edit.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve & publish" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not save");
  await expect(page.getByRole("textbox")).toHaveValue("Keep my unsaved edit.");
});

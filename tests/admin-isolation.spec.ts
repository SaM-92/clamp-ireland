import { expect, test } from "./helpers/ci-browser";
import { adminBaseURL, adminUrl, authorizeAdmin } from "./helpers/admin";

test("public site has neither admin links nor administrative pages/APIs, even with administrator credentials", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('a[href*="/admin"]')).toHaveCount(0);
  const paths = ["/admin", "/admin/moderation", "/admin/summaries",
    "/api/admin/overview", "/api/admin/traffic", "/api/admin/locations",
    "/api/admin/area-summaries", "/api/moderation/reports"];
  for (const path of paths) {
    expect((await request.get(path, { headers: { Authorization: "Bearer owner-session", Cookie: "clamp-admin-session=owner-session" } })).status()).toBe(404);
  }
  expect((await request.post("/api/admin/area-summaries", { data: {} })).status()).toBe(404);
  expect((await request.patch("/api/moderation/reports/10000000-0000-4000-8000-000000000001", { data: { action: "reject" } })).status()).toBe(404);
});

test("only the two approved confirmed identities can receive private HTML and call admin APIs", async ({ page, request }) => {
  for (const token of ["outsider-session", "unconfirmed-session", "expired-session"]) {
    await authorizeAdmin(page, token);
    await page.goto(adminUrl("/admin/summaries"));
    await expect(page).toHaveURL(adminUrl("/auth/sign-in"));
    await expect(page.getByRole("heading", { name: "Review nearby summaries" })).toHaveCount(0);
    expect((await request.get(adminUrl("/api/admin/overview"), { headers: { Cookie: `clamp-admin-session=${token}` } })).status()).toBe(403);
  }
  for (const token of ["owner-session", "cofounder-session"]) {
    await authorizeAdmin(page, token);
    await page.goto(adminUrl("/admin"));
    await expect(page.getByRole("heading", { name: "Community overview" })).toBeVisible();
    const response = await request.get(adminUrl("/api/admin/overview"), { headers: { Cookie: `clamp-admin-session=${token}` } });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  }
});

test("administrator sign-in and sign-out use a private cookie and block cross-origin actions", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(adminUrl("/auth/sign-in"));
  await page.getByLabel("Email", { exact: true }).fill("outsider@fixture.invalid");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Access denied");
  await page.getByLabel("Email", { exact: true }).fill("owner@fixture.invalid");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Community overview" })).toBeVisible();
  const cookies = await page.context().cookies(adminBaseURL);
  const session = cookies.find((cookie) => cookie.name === "clamp-admin-session")!;
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe("Strict");
  expect(await page.evaluate(() => document.cookie)).not.toContain("clamp-admin-session");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  const headers = { Cookie: "clamp-admin-session=owner-session", Origin: "https://public.fixture.invalid" };
  expect((await request.post(adminUrl("/api/auth/sign-out"), { headers })).status()).toBe(403);
  expect((await request.patch(adminUrl("/api/moderation/reports/10000000-0000-4000-8000-000000000001"), {
    headers, data: { action: "reject" },
  })).status()).toBe(403);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(adminUrl("/auth/sign-in"));
  expect((await page.context().cookies(adminBaseURL)).some((cookie) => cookie.name === "clamp-admin-session")).toBe(false);
  await page.goto(adminUrl("/admin"));
  await expect(page).toHaveURL(adminUrl("/auth/sign-in"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("session checks preserve unsaved review edits and sign-out clears other admin tabs", async ({ page }) => {
  await authorizeAdmin(page);
  await page.route("**/api/moderation/reports", (route) => route.fulfill({ json: [{
    id: "20000000-0000-4000-8000-000000000001",
    locationId: "30000000-0000-4000-8000-000000000001",
    reporterType: "witness", description: "Review fixture",
    createdAt: "2026-09-22T10:00:00Z", hasImage: false, imageUrl: null, imageError: null,
  }] }));
  await page.goto(adminUrl("/admin/moderation"));
  const input = page.getByLabel("Public note after review");
  await input.fill("Factual draft still being edited.");
  await Promise.all([
    page.waitForResponse((response) => response.url() === adminUrl("/api/auth/session") && response.status() === 200),
    page.evaluate(() => window.dispatchEvent(new Event("focus"))),
  ]);
  await expect(input).toHaveValue("Factual draft still being edited.");
  const other = await page.context().newPage();
  await other.goto(adminUrl("/admin"));
  await other.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(adminUrl("/auth/sign-in"));
  await expect(page.getByLabel("Public note after review")).toHaveCount(0);
  await other.close();
});

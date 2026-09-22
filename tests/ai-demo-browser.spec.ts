import { expect, test } from "@playwright/test";

test("production never exposes the AI demonstration", async ({ request }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION !== "true", "Production-only route isolation check");
  expect((await request.get("/dev/ai-demo")).status()).toBe(404);
  expect((await request.post("/api/dev/ai-demo", { data: { example: "summary" } })).status()).toBe(404);
});

test("local AI demo is usable on a phone and clearly separates loading, model output, local rules and errors", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION === "true", "Development-only UI");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto("/dev/ai-demo");
  test.skip(response?.status() === 404, "Explicit local demo flag is not enabled");
  let calls = 0;
  await page.route("**/api/dev/ai-demo", async (route) => {
    calls++;
    const { example } = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (example === "allowed-note") {
      await route.fulfill({ status: 503, json: { error: "Content checks are temporarily unavailable. Nothing was submitted.", remaining: 7 } });
    } else if (example === "unsafe-username") {
      await route.fulfill({ json: { source: "local-rule", kind: "policy", allowed: false,
        message: "Please remove profanity before continuing.", durationMs: 2, remaining: 7, cached: false } });
    } else {
      await route.fulfill({ json: { source: "azure", kind: "summary",
        message: "Reports mention unclear visitor permit signs.", durationMs: 4200, remaining: 7, cached: true } });
    }
  });
  await expect(page.getByRole("heading", { name: "See the AI work." })).toBeVisible();
  const summary = page.getByRole("region", { name: "One-sentence summary" });
  await summary.getByRole("button").click();
  await expect(summary.getByRole("button", { name: "Checking..." })).toBeDisabled();
  await expect(summary.getByText("Reports mention unclear visitor permit signs.")).toBeVisible();
  await expect(summary.getByText(/cached result/)).toBeVisible();
  await expect(summary.getByText(/draft, not human-approved/)).toBeVisible();
  const username = page.getByRole("region", { name: "Abusive username" });
  await username.getByRole("button").click();
  await expect(username.getByText("Local policy rule / no model call")).toBeVisible();
  await expect(username.getByText("Blocked by content policy")).toBeVisible();
  const allowed = page.getByRole("region", { name: "Factual criticism" });
  await allowed.getByRole("button").click();
  await expect(allowed.getByRole("alert")).toContainText("temporarily unavailable");
  expect(calls).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 812, height: 375 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

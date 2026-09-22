import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

declare global {
  interface Window {
    renderSummary?: (id: string, preview: boolean) => void;
  }
}

const uuid = "00000000-0000-4000-8000-000000000001";
const draftId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-09-22T10:00:00+00:00";
const sentence = "Reports mention visitor parking permits.";
const setup = { state: "ready", message: "Mock provider workspace: generation may incur charges in production." };
const draft = { id: draftId, sentence, source_fingerprint: "a".repeat(64), generated_at: timestamp };
const display = { sentence, sourceCount: 2, radiusMetres: 500, generatedAt: timestamp, reviewedAt: timestamp };
function workspace() {
  return {
    locationId: uuid, radiusMetres: 500, sourceCount: 2, sourceBytes: 120,
    sourceFingerprint: "a".repeat(64), blockedReason: null as string | null,
    notes: [{ description: "Visitor parking permits are mentioned." }, { description: "<img src=x onerror=alert('unsafe')> Untrusted fixture text." }],
    draft: null as typeof draft | null, published: null as typeof display | null,
  };
}
async function mockLocations(page: Page) {
  await page.route("**/api/locations", (route) => route.fulfill({ json: [
    { id: uuid, lat: 53.2158, lng: -6.6669, reportCount: 2, riskScore: 20, riskLevel: "low" },
  ] }));
}
async function chooseLocation(page: Page) {
  await page.goto("/admin/summaries");
  await page.getByRole("combobox", { name: "Choose a reported location" }).selectOption(uuid);
  await expect(page.getByRole("heading", { name: "Nearby source notes" })).toBeVisible();
}

test("summary routes reject unauthenticated generation/review and never expose a private workspace", async ({ request }) => {
  const response = await request.get("/api/admin/area-summaries");
  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await request.post("/api/admin/area-summaries", { data: { locationId: uuid } })).status()).toBe(403);
  expect((await request.patch(`/api/admin/area-summaries/${draftId}`, {
    data: { action: "approve", sentence, sourceFingerprint: "a".repeat(64), reviewed: true },
  })).status()).toBe(403);
  expect((await request.get("/api/locations/not-a-uuid/summary")).status()).toBe(400);
});

test("375px admin workspace selects real API locations, generates only on click, and confirms edited approval", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockLocations(page);
  const state = workspace();
  const writes: unknown[] = [];
  await page.route("**/api/admin/area-summaries**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      writes.push(request.postDataJSON()); state.draft = draft;
    } else if (request.method() === "PATCH") {
      const decision = request.postDataJSON(); writes.push(decision);
      state.published = { ...display, sentence: decision.sentence }; state.draft = null;
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({ json: { setup, workspace: request.url().includes("locationId") || request.method() === "POST" ? state : null } });
  });
  await chooseLocation(page);
  expect(writes).toEqual([]);
  await expect(page.getByText(/200 approved notes/)).toBeVisible();
  await expect(page.getByText(/48,000 UTF-8 source bytes/)).toBeVisible();
  await page.getByText("Read all 2 source notes before approval").click();
  await expect(page.locator("ol")).toContainText("<img src=x");
  await expect(page.locator("ol img, ol script")).toHaveCount(0);
  await page.getByRole("button", { name: "Generate draft (may incur cost)" }).click();
  const approval = page.getByRole("button", { name: "Approve & publish summary" });
  await expect(approval).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("textbox", { name: "One-sentence summary" }).fill("Reports mention registration for visitor parking.");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(approval).toBeDisabled();
  await page.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await expect(approval).toBeEnabled();
  expect((await approval.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await approval.click();
  await expect(page.getByRole("status")).toContainText("Human-reviewed summary published");
  await expect(page.getByRole("region", { name: "Current published summary" })).toContainText("Reports mention registration");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(writes).toEqual([
    { locationId: uuid, regenerate: false },
    { action: "approve", sentence: "Reports mention registration for visitor parking.", sourceFingerprint: "a".repeat(64), reviewed: true },
  ]);
  await page.screenshot({ path: test.info().outputPath("area-summary-admin-375.png"), fullPage: true });
});

test("regeneration error preserves approved text and unsaved draft, but access failure clears private state", async ({ page }) => {
  await mockLocations(page);
  const state = { ...workspace(), draft, published: display };
  let lostAccess = false;
  await page.route("**/api/admin/area-summaries**", (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 429, json: { error: "Provider quota reached. No automatic retry." } });
    if (route.request().method() === "PATCH") {
      lostAccess = true; return route.fulfill({ status: 403, body: "Session ended", contentType: "text/plain" });
    }
    return route.fulfill(lostAccess ? { status: 403, json: { error: "Access ended" } } : {
      json: { setup, workspace: route.request().url().includes("locationId") ? state : null },
    });
  });
  await chooseLocation(page);
  await page.getByRole("textbox").fill("Reports mention permits for visitors.");
  await page.getByRole("button", { name: "Regenerate draft (paid request)" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Provider quota");
  await expect(page.getByRole("textbox")).toHaveValue("Reports mention permits for visitors.");
  await expect(page.getByRole("region", { name: "Current published summary" })).toContainText(sentence);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve & publish summary" }).click();
  await expect(page.getByRole("link", { name: "Sign in as an administrator" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Current published summary" })).toHaveCount(0);
  await expect(page.getByText("Read all 2 source notes before approval")).toHaveCount(0);
});

test("over-limit and unconfigured workspaces explain why no paid generation is possible", async ({ page }) => {
  await mockLocations(page);
  const state = { ...workspace(), sourceCount: 201, sourceBytes: 50_000,
    notes: [], blockedReason: "This complete neighbourhood exceeds 200 notes or 48,000 UTF-8 bytes. No subset will be used." };
  let writes = 0;
  let configured = true;
  await page.route("**/api/admin/area-summaries**", (route) => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: {
      setup: configured ? setup : { state: "unconfigured", message: "Configure server-only OPENAI_API_KEY and apply migration 0004." },
      workspace: configured && route.request().url().includes("locationId") ? state : null,
    } });
  });
  await chooseLocation(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("No subset");
  await expect(page.getByRole("button", { name: "Generate draft (may incur cost)" })).toBeDisabled();
  expect(writes).toBe(0);
  configured = false;
  await page.getByRole("button", { name: "Reload workspace" }).click();
  await expect(page.getByText("Configure server-only OPENAI_API_KEY and apply migration 0004.")).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Generate draft/ })).toHaveCount(0);
});

test("stale approval clears the draft and requires reload rather than publishing old wording", async ({ page }) => {
  await mockLocations(page);
  const state = { ...workspace(), draft };
  await page.route("**/api/admin/area-summaries**", (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 409, json: { error: "Sources changed. Reload and review a fresh draft." } })
    : route.fulfill({ json: { setup, workspace: route.request().url().includes("locationId") ? state : null } }));
  await chooseLocation(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve & publish summary" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Sources changed");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("browser-local location notes explicitly require a backend and never fetch or generate a summary", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION === "true", "This assertion is for the development-only preview.");
  await page.addInitScript((id) => localStorage.setItem("clamp-local-preview-v1", JSON.stringify([{
    id, lat: 53.2158, lng: -6.6669, reporterType: "witness", hasImage: false,
    createdAt: "2026-09-22T10:00:00Z", description: "Local-only browser fixture.", incidentDate: null,
  }])), uuid);
  const requests: string[] = [];
  page.on("request", (request) => { if (/\/summary(?:\?|$)|\/api\/admin\/area-summaries/.test(request.url())) requests.push(request.url()); });
  await page.goto("/");
  await page.locator(".location-card").first().click();
  await expect(page.getByRole("region", { name: "Nearby reports summary" })).toContainText("Real area summaries require a configured backend");
  expect(requests).toEqual([]);
});

// Bundle the real public React component with the installed Next/TypeScript
// tooling, not a substitute component. This isolated browser harness exercises
// real effects/CSS without changing deployment env or requiring a live backend.
test.describe("public summary component", () => {
  let script: string;
  let css: string;
  test.beforeAll(async ({}, info) => {
    const require = createRequire(path.resolve("package.json"));
    const output = info.outputPath("public-component");
    await mkdir(output, { recursive: true });
    const entry = path.join(output, "entry.js");
    const loader = path.join(output, "typescript-loader.cjs");
    await writeFile(loader, `
      const ts = require(${JSON.stringify(require.resolve("typescript"))});
      module.exports = function(source) {
        return ts.transpileModule(source, {
          fileName: this.resourcePath,
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }
        }).outputText;
      };
    `);
    await writeFile(entry, `
      const React = require(${JSON.stringify(require.resolve("react"))});
      const { createRoot } = require(${JSON.stringify(require.resolve("react-dom/client"))});
      const { NearbySummary } = require(${JSON.stringify(path.resolve("src", "modules", "area-summaries", "components", "NearbySummary.tsx"))});
      const root = createRoot(document.getElementById("root"));
      window.renderSummary = (locationId, preview=false) => root.render(React.createElement(NearbySummary, {key: locationId+preview, locationId, preview}));
    `);
    const compiled = require("next/dist/compiled/webpack/webpack");
    await new Promise<void>((resolve, reject) => compiled.webpack({
      mode: "development", devtool: false, target: "web", entry,
      output: { path: output, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.resolve("node_modules")] },
      externals: { "./AreaSummaries.module.css": "window.summaryStyles" },
      module: { rules: [{
        test: /\.tsx?$/, exclude: /node_modules/,
        use: { loader },
      }] },
    }, (error: Error | null, stats?: { hasErrors(): boolean; toString(): string }) => {
      if (error || !stats || stats.hasErrors()) reject(error ?? new Error(stats?.toString() ?? "Component compilation failed"));
      else resolve();
    }));
    script = await readFile(path.join(output, "bundle.js"), "utf8");
    css = await readFile(path.resolve("src", "modules", "area-summaries", "components", "AreaSummaries.module.css"), "utf8");
  });

  async function mount(page: Page, id = uuid, preview = false) {
    await page.route("http://summary.test/", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }));
    await page.goto("http://summary.test/");
    await page.evaluate(() => { Object.assign(window, { summaryStyles: { nearby: "nearby" } }); });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await page.evaluate(({ id, preview }) => {
      if (!window.renderSummary) throw new Error("Summary component was not mounted");
      window.renderSummary(id, preview);
    }, { id, preview });
  }

  test("375px public display is compact, read-only and clears obsolete text on fresh empty/error responses", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    let state: "approved" | "empty" | "error" = "approved";
    const methods: string[] = [];
    await page.route("**/api/locations/*/summary", (route) => {
      methods.push(route.request().method());
      return state === "error" ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.fulfill({
        json: state === "approved" ? { state: "available", summary: display } : { state: "none", message: "No current human-approved summary is available." },
      });
    });
    await mount(page);
    await expect(page.getByText(sentence, { exact: true })).toBeVisible();
    await expect(page.getByText(/100 m map circle and risk score are unchanged/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    state = "empty";
    await page.evaluate(() => window.dispatchEvent(new Event("area-summary-changed")));
    await expect(page.getByText(sentence, { exact: true })).toHaveCount(0);
    await expect(page.getByText("No current human-approved summary is available.")).toBeVisible();
    state = "approved";
    await page.evaluate(() => window.dispatchEvent(new Event("area-summary-changed")));
    await expect(page.getByText(sentence, { exact: true })).toBeVisible();
    state = "error";
    await page.evaluate(() => window.dispatchEvent(new Event("area-summary-changed")));
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(sentence, { exact: true })).toHaveCount(0);
    state = "empty";
    await page.getByRole("button", { name: "Retry summary" }).click();
    await expect(page.getByText("No current human-approved summary is available.")).toBeVisible();
    expect(methods.every((method) => method === "GET")).toBe(true);
  });

  test("invalid location and preview never fetch; malformed or identifying projection fields cannot render", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/locations/*/summary", (route) => {
      calls++;
      return route.fulfill({ json: { state: "available", summary: { ...display, sentence: "Reports mention <script>unsafe</script>.", reviewed_by: "PRIVATE" } } });
    });
    await mount(page, "not-a-uuid");
    await expect(page.getByText(/Real area summaries require/)).toBeVisible();
    expect(calls).toBe(0);
    await page.evaluate((id) => {
      if (!window.renderSummary) throw new Error("Summary component was not mounted");
      window.renderSummary(id, true);
    }, uuid);
    await expect(page.getByText(/Real area summaries require/)).toBeVisible();
    expect(calls).toBe(0);
    await page.evaluate((id) => {
      if (!window.renderSummary) throw new Error("Summary component was not mounted");
      window.renderSummary(id, false);
    }, uuid);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("PRIVATE", { exact: true })).toHaveCount(0);
    await expect(page.locator("#root script")).toHaveCount(0);
    expect(calls).toBe(1);
  });
});

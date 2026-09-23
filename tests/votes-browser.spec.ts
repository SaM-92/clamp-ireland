import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { ReportVotesProps } from "../src/modules/votes/components/ReportVotes";

declare global {
  interface Window {
    renderVotes: (props: ReportVotesProps) => void;
    renderVoteBatch: (ids: string[]) => void;
    clearTestPreviewVotes: () => void;
    seedVotePreview: () => unknown;
    votePreviewMetrics: () => unknown;
    voteToken: string | null;
  }
}
const id = "10000000-0000-4000-8000-000000000001";
const counts = { agreeCount: 3, disagreeCount: 2 };
const ready: ReportVotesProps = { reportId: id, counts, viewer: { status: "ready", vote: null } };
const preview: ReportVotesProps = { reportId: id, counts: { agreeCount: 0, disagreeCount: 0 }, preview: true };
let script: string;
let css: string;

test.beforeAll(async ({}, info) => {
  const require = createRequire(path.resolve("package.json"));
  const output = info.outputPath("votes-component");
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
    const { ReportVotes } = require(${JSON.stringify(path.resolve("src", "modules", "votes", "components", "ReportVotes.tsx"))});
    const { useReportVoteViewer } = require(${JSON.stringify(path.resolve("src", "modules", "votes", "useReportVoteViewer.ts"))});
    const { clearPreviewVotes } = require(${JSON.stringify(path.resolve("src", "modules", "votes", "preview.ts"))});
    const { savePreviewReports, loadPreviewReports, summarizePreviewReports } = require(${JSON.stringify(path.resolve("src", "modules", "reports", "lib", "previewReports.ts"))});
    const root = createRoot(document.getElementById("root"));
    window.renderVotes = props => root.render(React.createElement(ReportVotes, props));
    function Batch({ids}) {
      const {viewerFor, recordVote, retry} = useReportVoteViewer(ids, false);
      return React.createElement(React.Fragment, null, ids.map(reportId => React.createElement(ReportVotes, {
        key: reportId, reportId, counts: {agreeCount: 1, disagreeCount: 0}, viewer: viewerFor(reportId),
        onChange: recordVote, onRetry: retry
      })));
    }
    window.renderVoteBatch = ids => root.render(React.createElement(Batch, {ids}));
    window.clearTestPreviewVotes = clearPreviewVotes;
    window.votePreviewMetrics = () => summarizePreviewReports(loadPreviewReports(), new Date("2026-09-22T12:00:00Z"));
    window.seedVotePreview = () => {
      savePreviewReports([{
        id: "${id}", lat: 53.2, lng: -6.6, reporterType: "victim", hasImage: false,
        createdAt: "2026-09-22T10:00:00Z", description: "Preview note", incidentDate: null
      }]);
      return window.votePreviewMetrics();
    };
  `);
  const compiled = require("next/dist/compiled/webpack/webpack");
  await new Promise<void>((resolve, reject) => compiled.webpack({
    mode: "development", devtool: false, target: "web", entry,
    output: { path: output, filename: "bundle.js" },
    resolve: {
      extensions: [".tsx", ".ts", ".js"], modules: [path.resolve("node_modules")],
      alias: { "@": path.resolve("src") },
    },
    externals: {
      "./ReportVotes.module.css": "window.voteStyles",
      "@/modules/auth/lib/session": "window.voteAuth",
    },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: { loader } }] },
  }, (error: Error | null, stats?: { hasErrors(): boolean; toString(): string }) => {
    if (error || !stats || stats.hasErrors()) reject(error ?? new Error(stats?.toString() ?? "Vote component compilation failed"));
    else resolve();
  }));
  script = await readFile(path.join(output, "bundle.js"), "utf8");
  const globals = await readFile(path.resolve("src", "app", "globals.css"), "utf8");
  css = globals.replace(/@import[^\n]+/g, "") + "\n" +
    await readFile(path.resolve("src", "modules", "votes", "components", "ReportVotes.module.css"), "utf8");
});

async function mount(page: Page, props: ReportVotesProps = ready) {
  await page.route("http://votes.test/", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><ul class="public-notes"><li id="root"></li></ul></body></html>',
  }));
  await page.goto("http://votes.test/");
  await page.evaluate(() => {
    window.voteToken = "fixture-token";
    Object.assign(window, {
      voteStyles: { votes: "votes", buttons: "buttons", hint: "hint", error: "error", retry: "retry" },
      voteAuth: {
        getSession: async () => ({ configured: true, signedIn: Boolean(window.voteToken) }),
        subscribeAuth: (callback: () => void) => {
          window.addEventListener("vote-test-auth", callback);
          return () => window.removeEventListener("vote-test-auth", callback);
        },
      },
    });
  });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.evaluate((props) => window.renderVotes(props), props);
}

test("vote HTTP endpoints require sign-in and mark every response private", async ({ request }) => {
  for (const response of [
    await request.get(`/api/report-votes?reportIds=${id}`),
    await request.put(`/api/report-votes/${id}`, { data: { vote: "agree" } }),
  ]) {
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["vary"].toLowerCase()).toContain("cookie");
  }
});

test("375px preview toggles, switches, persists and resets without backend traffic or scoring changes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 500, json: { error: "Preview must not call the backend" } });
  });
  await mount(page, preview);
  const before = await page.evaluate(() => window.seedVotePreview());
  const originalNotes = await page.evaluate(() => localStorage.getItem("clamp-local-preview-v1"));
  const agree = page.getByRole("button", { name: /^Agreed/ });
  const disagree = page.getByRole("button", { name: /^Disagreed/ });
  await expect(agree).toBeEnabled();
  await agree.focus();
  await page.keyboard.press("Space");
  await expect(agree).toHaveAttribute("aria-pressed", "true");
  await expect(agree).toHaveText("Agreed 1");
  await page.keyboard.press("Enter");
  await expect(agree).toHaveText("Agreed 0");
  await disagree.click();
  await agree.click();
  await expect(agree).toHaveText("Agreed 1");
  await expect(disagree).toHaveText("Disagreed 0");
  await expect(page.getByText(/Community feedback only, not proof/)).toBeVisible();
  await expect(page.getByText(/one simulated voter/)).toBeVisible();
  for (const button of [agree, disagree]) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mount(page, preview);
  await expect(agree).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.votePreviewMetrics())).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("clamp-local-preview-v1"))).toBe(originalNotes);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("clamp-local-preview-votes-v1")!))).toEqual({ [id]: "agree" });
  await page.evaluate(() => window.clearTestPreviewVotes());
  await expect(agree).toHaveText("Agreed 0");
  await expect(agree).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.votePreviewMetrics())).toEqual(before);
  expect(requests).toEqual([]);
});

test("invalid preview storage is an explicit error, not zero-count success or an automatic overwrite", async ({ page }) => {
  await mount(page, preview);
  for (const saved of ["{", JSON.stringify({ [id]: "other" }), JSON.stringify({ userId: "PRIVATE" })]) {
    await page.evaluate((saved) => {
      localStorage.setItem("clamp-local-preview-votes-v1", saved);
      window.dispatchEvent(new Event("clamp-preview-votes-changed"));
    }, saved);
    await expect(page.getByRole("alert")).toContainText("Saved preview votes are invalid");
    await expect(page.getByRole("button", { name: /^Agreed/ })).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem("clamp-local-preview-votes-v1"))).toBe(saved);
  }
  await page.evaluate(() => window.clearTestPreviewVotes());
  await expect(page.getByRole("button", { name: /^Agreed/ })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "clamp-local-preview-votes-v1") throw new Error("Preview storage is blocked.");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: /^Agreed/ }).click();
  await expect(page.getByRole("alert")).toContainText("Preview storage is blocked");
  await expect(page.getByRole("button", { name: /^Agreed/ })).toHaveAttribute("aria-pressed", "false");
});

test("private controls show failures, disable while busy, switch/remove and prompt on expired auth", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let status = 500;
  let hold = false;
  let release = () => {};
  let selected: string | null = null;
  const bodies: unknown[] = [];
  await page.route("**/api/report-votes/*", async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    expect(route.request().headers()["authorization"]).toBeUndefined();
    expect(route.request().headers()["origin"]).toBe("http://votes.test");
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    if (status !== 200) return route.fulfill({ status, json: { error: status === 401 ? "Sign in with Google to vote." : "Feedback is unavailable. Please try again." } });
    selected = body.vote;
    return route.fulfill({ json: { reportId: id, vote: selected, agreeCount: 3 + (selected === "agree" ? 1 : 0), disagreeCount: 2 + (selected === "disagree" ? 1 : 0) } });
  });
  await mount(page);
  const agree = page.getByRole("button", { name: /^Agreed/ });
  const disagree = page.getByRole("button", { name: /^Disagreed/ });
  await agree.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("alert")).toContainText("Feedback is unavailable");
  await expect(agree).toHaveText("Agreed 3");
  await expect(agree).toHaveAttribute("aria-pressed", "false");
  status = 200;
  hold = true;
  await agree.click();
  await expect(agree).toBeDisabled();
  await expect(disagree).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Saving feedback...");
  await expect.poll(() => bodies.length).toBe(2);
  release();
  hold = false;
  await expect(agree).toHaveText("Agreed 4");
  await expect(agree).toHaveAttribute("aria-pressed", "true");
  await disagree.focus();
  await page.keyboard.press("Enter");
  await expect(disagree).toHaveText("Disagreed 3");
  await expect(agree).toHaveText("Agreed 3");
  await disagree.click();
  await expect(disagree).toHaveText("Disagreed 2");
  await expect(page.getByRole("status")).toHaveText("Your feedback was removed.");
  expect(bodies).toEqual([{ vote: "agree" }, { vote: "agree" }, { vote: "disagree" }, { vote: null }]);
  status = 401;
  await agree.click();
  await expect(page.getByRole("link", { name: "Sign in to vote" })).toHaveAttribute("href", "/auth/sign-in");
  await expect(agree).toBeDisabled();
  await expect(agree).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("sign-out ignores an in-flight result and never retains a previous viewer's selection", async ({ page }) => {
  let release = () => {};
  await page.route("**/api/report-votes/*", async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { reportId: id, vote: "agree", agreeCount: 4, disagreeCount: 2 } });
  });
  await mount(page);
  await page.getByRole("button", { name: /^Agreed/ }).click();
  await expect(page.getByRole("status")).toHaveText("Saving feedback...");
  await page.evaluate(({ id, counts }) => window.renderVotes({ reportId: id, counts, viewer: { status: "signed-out" } }), { id, counts });
  await expect(page.getByRole("link", { name: "Sign in to vote" })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: /^Agreed/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /^Agreed/ })).toHaveText("Agreed 3");
});

test("50 notes use one private batch; retry and account changes clear private state without N+1 reads", async ({ page }) => {
  const ids = Array.from({ length: 50 }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  let reads = 0;
  let fail = true;
  await page.route("**/api/report-votes?*", (route) => {
    reads++;
    expect(new URL(route.request().url()).searchParams.get("reportIds")?.split(",")).toEqual(ids);
    return route.fulfill(fail ? { status: 500, json: { error: "<img src=x onerror=alert(1)> Read failed." } }
      : { json: { votes: ids.map((reportId) => ({ reportId, vote: "agree" })) } });
  });
  await mount(page);
  await page.evaluate((ids) => window.renderVoteBatch(ids), ids);
  await expect(page.getByRole("alert").first()).toContainText("Read failed");
  await expect(page.locator("#root img")).toHaveCount(0);
  expect(reads).toBe(1);
  fail = false;
  await page.getByRole("button", { name: "Retry your feedback" }).first().click();
  await expect(page.getByRole("button", { name: /^Agreed/ }).first()).toHaveAttribute("aria-pressed", "true");
  expect(reads).toBe(2);
  await page.evaluate(() => {
    window.voteToken = null;
    window.dispatchEvent(new Event("vote-test-auth"));
  });
  await expect(page.getByRole("link", { name: "Sign in to vote" })).toHaveCount(50);
  await expect(page.getByRole("button", { name: /^Agreed/ }).first()).toHaveAttribute("aria-pressed", "false");
  expect(reads).toBe(2);
});

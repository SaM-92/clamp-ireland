import { expect, test } from "@playwright/test";
import { sqlRuntime } from "./helpers/sql-runtime";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as trafficTypes from "../src/modules/analytics/types";
import { trafficCollectionAllowed } from "../src/modules/analytics/lib/policy";
import { renderToStaticMarkup } from "react-dom/server";

const nativeRequire = createRequire(path.resolve("package.json"));
function loadServer<T>(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const commonJs = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.resolve(file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, {
    module: commonJs, exports: commonJs.exports,
    Request, Response, Headers, URL, TextDecoder, Uint8Array, Error, Date,
    console: { error: () => {}, warn: () => {} },
    require: (id: string) => id === "server-only" ? {} : id in dependencies ? dependencies[id] : nativeRequire(id),
    ...globals,
  });
  return commonJs.exports as T;
}

test("traffic collection requires explicit opt-in, production, SQLite and no Vercel preview", () => {
  for (const enabled of [false, true]) {
    for (const nodeEnv of ["development", "test", "production", undefined]) {
      for (const databaseConfigured of [false, true]) {
          for (const vercelEnv of [undefined, "preview", "development", "production"]) {
            expect(trafficCollectionAllowed({ enabled, nodeEnv, databaseConfigured, vercelEnv }))
              .toBe(enabled && nodeEnv === "production" && databaseConfigured &&
                (vercelEnv === undefined || vercelEnv === "production"));
        }
      }
    }
  }
});

test("real public POST rejects invalid and cross-origin events before DB access, with bounded streaming bodies", async () => {
  let enabled = true;
  let writes = 0;
  let fail = false;
  const events: unknown[] = [];
  const parser = loadServer<typeof import("../src/modules/analytics/server/request")>(
    "src/modules/analytics/server/request.ts", { "../types": trafficTypes },
  );
  const route = loadServer<typeof import("../src/app/api/analytics/pageview/route")>(
    "src/app/api/analytics/pageview/route.ts", {
      "@/modules/analytics/server/config": { isTrafficEnabled: () => enabled },
      "@/modules/analytics/server/request": parser,
      "@/modules/analytics/server/repository": {
        incrementTraffic: async (event: unknown) => { writes++; events.push(event); if (fail) throw new Error("DB failed"); },
      },
    },
  );
  const request = (body: string, extra: Record<string, string> = {}) => new Request("https://site.test/api/analytics/pageview", {
    method: "POST", headers: { Origin: "https://site.test", "Content-Type": "application/json", ...extra }, body,
  });
  const valid = JSON.stringify({ route: "/", viewport: "mobile" });
  for (const [body, headers, status] of [
    [valid, { Origin: "https://evil.test" }, 403],
    [valid, { Origin: "null" }, 403],
    [valid, { "Sec-Fetch-Site": "cross-site" }, 403],
    [valid, { "Content-Type": "text/plain" }, 415],
    [valid, { "Content-Length": "257" }, 413],
    [valid, { "Content-Length": "NaN" }, 400],
    [" ".repeat(257), {}, 413],
    ["{", {}, 400],
    [JSON.stringify({ route: "/admin", viewport: "mobile" }), {}, 400],
    [JSON.stringify({ route: "/?search=private", viewport: "mobile" }), {}, 400],
    [JSON.stringify({ route: "https://site.test/", viewport: "mobile" }), {}, 400],
    [JSON.stringify({ route: "/", viewport: "375x812" }), {}, 400],
    [JSON.stringify({ route: "/", viewport: "mobile", email: "not-collected@example.test" }), {}, 400],
    [JSON.stringify({ route: "/", viewport: "mobile", referrer: "private" }), {}, 400],
  ] as [string, Record<string, string>, number][]) {
    expect((await route.POST(request(body, headers))).status).toBe(status);
    expect(writes).toBe(0);
  }
  const noOrigin = new Request("https://site.test/api/analytics/pageview", { method: "POST", body: valid, headers: { "Content-Type": "application/json" } });
  expect((await route.POST(noOrigin)).status).toBe(403);
  const chunks = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(" ".repeat(180)));
      controller.enqueue(new TextEncoder().encode(" ".repeat(180)));
      controller.close();
    },
  });
  const streamed = new Request("https://site.test/api/analytics/pageview", {
    method: "POST", headers: { Origin: "https://site.test", "Content-Type": "application/json" },
    body: chunks, ...{ duplex: "half" },
  });
  expect((await route.POST(streamed)).status).toBe(413);
  expect(writes).toBe(0);
  enabled = false;
  const disabled = await route.POST(request(valid));
  expect(disabled.status).toBe(200);
  expect(await disabled.json()).toEqual({ enabled: false, reason: "Analytics not enabled" });
  expect(writes).toBe(0);
  enabled = true;
  const recorded = await route.POST(request(valid, { "Sec-Fetch-Site": "same-origin" }));
  expect(await recorded.json()).toEqual({ enabled: true, recorded: true });
  expect(recorded.headers.get("cache-control")).toBe("no-store");
  expect(events).toEqual([{ route: "/", viewport: "mobile" }]);
  fail = true;
  const failed = await route.POST(request(valid));
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: "Traffic collection unavailable." });
});

test("admin traffic keeps authorization ahead of disabled status and aggregate reads", async () => {
  let authorized = false;
  let enabled = false;
  let reads = 0;
  let fail = false;
  const summary = { enabled: true, from: "2026-08-24", through: "2026-09-22", totalPageviews: 8, mobilePageviews: 3, days: [] };
  const route = loadServer<typeof import("../apps/admin/src/app/api/admin/traffic/route")>(
    "apps/admin/src/app/api/admin/traffic/route.ts", {
      "@/modules/auth/lib/requireAdmin": { requireAdmin: async () => authorized ? { id: "admin" } : null },
      "@/modules/analytics/server/config": { isTrafficEnabled: () => enabled },
      "@/modules/analytics/server/repository": { getTrafficSummary: async () => { reads++; if (fail) throw new Error("offline"); return summary; } },
    },
  );
  const request = new Request("https://site.test/api/admin/traffic?days=9999");
  expect((await route.GET(request)).status).toBe(403);
  expect(reads).toBe(0);
  authorized = true;
  expect(await (await route.GET(request)).json()).toEqual({ enabled: false, reason: "Analytics not enabled" });
  expect(reads).toBe(0);
  enabled = true;
  const response = await route.GET(request);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  expect(await response.json()).toEqual(summary);
  fail = true;
  const failed = await route.GET(request);
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: "Could not load traffic totals." });
});

test("repository reads a maximum 30-day UTC window and aggregates actual rows, not user records", async () => {
  const f = await sqlRuntime();
  try {
    await f.db.exec(`INSERT INTO traffic_daily VALUES
      ('2026-09-22','/','mobile',3),('2026-09-22','/appeal','desktop',7),
      ('2026-09-21','/','tablet',2),('2026-08-23','/','mobile',100),('2026-09-23','/','mobile',100)`);
    const repository = f.load<typeof import("../src/modules/analytics/server/repository")>("src/modules/analytics/server/repository.ts");
    const now = new Date("2026-09-22T23:59:00Z");
    expect(await repository.getTrafficSummary(now)).toEqual({
      enabled: true, from: "2026-08-24", through: "2026-09-22", totalPageviews: 12, mobilePageviews: 3,
      days: [{ day: "2026-09-22", pageviews: 10, mobilePageviews: 3 }, { day: "2026-09-21", pageviews: 2, mobilePageviews: 0 }],
    });
    await f.db.prepare("DELETE FROM traffic_daily").run();
    expect(await repository.getTrafficSummary(now)).toMatchObject({ enabled: true, totalPageviews: 0, days: [] });
    await f.pool.close();
    await expect(async () => repository.getTrafficSummary(now)).rejects.toThrow();
  } finally { await f.close(); }
});

test("standalone traffic migration enforces aggregate-only Azure SQL storage, UTC and prune-on-increment", async () => {
  const f = await sqlRuntime();
  try {
    expect((await f.db.prepare(
      "SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='traffic_daily' AND TABLE_SCHEMA='dbo' ORDER BY ORDINAL_POSITION",
    ).all()).map((row) => row.name)).toEqual(["day", "route", "viewport", "pageviews"]);
    const today = new Date().toISOString().slice(0, 10);
    const day30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const day29 = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    await f.db.prepare("INSERT INTO traffic_daily VALUES (?,'/','desktop',10),(?,'/','desktop',20)").run(day30, day29);
    const repository = f.load<typeof import("../src/modules/analytics/server/repository")>("src/modules/analytics/server/repository.ts");
    await expect(async () => f.db.prepare("INSERT INTO traffic_daily VALUES (?,'/admin','mobile',1)").run(today)).rejects.toThrow();
    for (let n = 0; n < 12; n++) await repository.incrementTraffic({ route: "/", viewport: "mobile" });
    await repository.incrementTraffic({ route: "/appeal", viewport: "tablet" });
    expect(await f.db.prepare("SELECT route,viewport,pageviews FROM traffic_daily WHERE day=? ORDER BY route").all(today)).toEqual([
      { route: "/", viewport: "mobile", pageviews: 12 },
      { route: "/appeal", viewport: "tablet", pageviews: 1 },
    ]);
    expect(await f.db.prepare("SELECT * FROM traffic_daily WHERE day<?").all(day29)).toHaveLength(0);
    expect(await f.db.prepare("SELECT * FROM traffic_daily WHERE day=?").all(day29)).toHaveLength(1);
  } finally { await f.close(); }
});

test("tracker sends only route and coarse viewport, omits credentials/referrer and never retries", async () => {
  const requests: RequestInit[] = [];
  let fail = false;
  let disabled = false;
  const client = loadServer<typeof import("../src/modules/analytics/lib/client")>(
    "src/modules/analytics/lib/client.ts", { "../types": trafficTypes }, {
      AbortController, setTimeout, clearTimeout,
      fetch: async (url: string, init: RequestInit) => {
        expect(url).toBe("/api/analytics/pageview");
        requests.push(init);
        if (fail) throw new Error("network unavailable");
        return Response.json(disabled ? { enabled: false, reason: "Analytics not enabled" } : { enabled: true, recorded: true });
      },
    },
  );
  for (const [width, expected] of [[375, "mobile"], [760, "mobile"], [761, "tablet"], [1000, "tablet"], [1001, "desktop"]] as const) {
    expect(client.viewportCategory((query) => ({ matches: width <= Number(query.match(/\d+/)![0]) }))).toBe(expected);
  }
  expect(await client.sendPageview({ route: "/", viewport: "mobile" })).toBe("recorded");
  expect(requests[0]).toMatchObject({
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
    keepalive: true, mode: "same-origin", redirect: "error", cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  expect(JSON.parse(requests[0].body as string)).toEqual({ route: "/", viewport: "mobile" });
  disabled = true;
  expect(await client.sendPageview({ route: "/", viewport: "desktop" })).toBe("disabled");
  fail = true;
  expect(await client.sendPageview({ route: "/appeal", viewport: "tablet" })).toBe("failed");
  expect(requests).toHaveLength(3);
});

test("tracker counts committed allow-listed route changes, not duplicate effects or prefetch renders", () => {
  let pathname = "/";
  const ref = { current: null };
  const effects: (() => void)[] = [];
  const events: unknown[] = [];
  const tracker = loadServer<typeof import("../src/modules/analytics/components/TrafficTrackerClient")>(
    "src/modules/analytics/components/TrafficTrackerClient.tsx", {
      react: { useRef: () => ref, useEffect: (effect: () => void) => effects.push(effect) },
      "next/navigation": { usePathname: () => pathname },
      "../lib/client": {
        sendPageview: async (event: unknown) => { events.push(event); },
        viewportCategory: () => "mobile",
      },
    }, { window: { matchMedia: () => ({ matches: true }) } },
  );
  tracker.TrafficTrackerClient();
  expect(events).toEqual([]);
  effects.pop()!();
  tracker.TrafficTrackerClient();
  effects.pop()!();
  expect(events).toEqual([{ route: "/", viewport: "mobile" }]);
  for (const next of ["/appeal", "/admin", "/", "/auth/sign-in"]) {
    pathname = next;
    tracker.TrafficTrackerClient();
    effects.pop()!();
  }
  expect(events).toEqual([
    { route: "/", viewport: "mobile" }, { route: "/appeal", viewport: "mobile" }, { route: "/", viewport: "mobile" },
  ]);
});

test("traffic table renders real daily and mobile-sized counts without 375px page overflow", async ({ page }) => {
  const state: unknown[] = [{
    enabled: true, from: "2026-08-24", through: "2026-09-22", totalPageviews: 17, mobilePageviews: 6,
    days: [{ day: "2026-09-22", pageviews: 12, mobilePageviews: 4 }, { day: "2026-09-21", pageviews: 5, mobilePageviews: 2 }],
  }, null, false, 0];
  const styles = Object.fromEntries(["panel", "heading", "hint", "totals", "tableRegion", "table"].map((name) => [name, name]));
  const component = loadServer<typeof import("../src/modules/admin/components/TrafficPanel")>(
    "src/modules/admin/components/TrafficPanel.tsx", {
      react: { useState: () => [state.shift(), () => {}], useEffect: () => {} },
      "@/modules/analytics/types": trafficTypes,
      "./TrafficPanel.module.css": styles,
    },
  );
  const markup = renderToStaticMarkup(component.TrafficPanel());
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setContent(`<style>${readFileSync(path.resolve("src", "app", "globals.css"), "utf8")}
    ${readFileSync(path.resolve("src", "modules", "admin", "components", "TrafficPanel.module.css"), "utf8")}
    main { padding: 16px; }</style><main>${markup}</main>`);
  await expect(page.getByRole("definition")).toHaveText(["17", "6"]);
  await expect(page.getByRole("row")).toHaveText(["Day (UTC)PageviewsMobile-sized", "2026-09-22124", "2026-09-2152"]);
  await expect(page.getByText(/not unique people or devices/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

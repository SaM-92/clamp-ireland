import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { policyRuntime } from "./helpers/content-policy-runtime";
import { demoResultSchema } from "../src/modules/ai-demo/samples";
import { POLICY_TEXT } from "../src/modules/content-policy/policy";

function fixture(mode = "development") {
  const environment = { NODE_ENV: mode, ENABLE_LOCAL_AI_DEMO: true, AI_PROVIDER: "azure" };
  let calls = 0;
  let reservations = 0;
  let failed = false;
  const rt = policyRuntime({
    "@/lib/env": { env: environment },
    "@/modules/ai/server/config": { getAiConfiguration: () => ({ provider: "azure" }) },
    "@/modules/ai-demo/server/budget": {
      remainingDemoRequests: async () => 10 - reservations,
      reserveDemoRequest: async () => 10 - ++reservations,
    },
    "@/modules/area-summaries/server/provider": {
      generateSummaryFromSnapshot: async (value: { sources: { description: string }[] }) => {
        expect(value.sources).toHaveLength(3);
        calls++;
        if (failed) throw new Error("Private infrastructure detail");
        return { sentence: "Reports mention unclear visitor permit signs." };
      },
    },
    "@/modules/content-policy/server/check": { checkContentPolicy: async () => { calls++; } },
  });
  const route = rt.load<typeof import("../src/app/api/dev/ai-demo/route")>("src/app/api/dev/ai-demo/route.ts");
  const request = (example: unknown = "summary", origin = "http://localhost:3001", extra: object = {}) => new Request(
    "http://localhost:3001/api/dev/ai-demo", {
      method: "POST", headers: { host: "localhost:3001", origin, "content-type": "application/json" },
      body: JSON.stringify({ example, ...extra }),
    },
  );
  return { ...rt, route, request, environment, calls: () => calls, reservations: () => reservations, fail: () => { failed = true; } };
}

test("demo is unavailable in production even if someone enables its flag", async () => {
  const f = fixture("production");
  expect(f.route.GET().status).toBe(404);
  expect((await f.route.POST(f.request())).status).toBe(404);
  expect(f.calls()).toBe(0);
  expect(f.reservations()).toBe(0);
});

test("demo refuses cross-origin, LAN hosts, free text and oversized input before inference", async () => {
  const f = fixture();
  expect((await f.route.POST(f.request("summary", "https://attacker.example"))).status).toBe(403);
  expect((await f.route.POST(new Request("http://10.0.0.5:3001/api/dev/ai-demo", {
    method: "POST", headers: { host: "10.0.0.5:3001", origin: "http://10.0.0.5:3001" }, body: "{}",
  }))).status).toBe(403);
  for (const request of [
    f.request("unknown"), f.request("summary", undefined, { text: "private user text" }),
    f.request("summary", undefined, { padding: "a".repeat(600) }),
  ]) expect((await f.route.POST(request)).status).toBe(400);
  expect(f.calls()).toBe(0);
  expect(f.reservations()).toBe(0);
});

test("fixed summary examples use a labelled cache and local policy rejections cost no model calls", async () => {
  const f = fixture();
  const first = await f.route.POST(f.request());
  expect(first.headers.get("cache-control")).toBe("no-store");
  expect(await first.json()).toMatchObject({ source: "azure", kind: "summary", cached: false, remaining: 9 });
  expect(await (await f.route.POST(f.request())).json()).toMatchObject({ cached: true, remaining: 9 });
  expect(await (await f.route.POST(f.request("unsafe-username"))).json()).toMatchObject({
    source: "local-rule", decision: "blocked", text: POLICY_TEXT.profanity, remaining: 9,
  });
  expect(f.calls()).toBe(1);
  expect(f.reservations()).toBe(1);
});

test("demo classification exposes only the decision and fixed text, separate from generated summary text", async () => {
  const f = fixture();
  const result = await (await f.route.POST(f.request("allowed-note"))).json();
  expect(demoResultSchema.parse(result)).toMatchObject({
    kind: "policy", source: "azure", decision: "approve", text: POLICY_TEXT.allowed,
  });
  expect(result).not.toHaveProperty("message");
  expect(result).not.toHaveProperty("allowed");
  for (const invalid of [
    { ...result, text: "Invented feedback" },
    { ...result, decision: "blocked" },
    { ...result, ai_text: "Extra feedback" },
    { ...result, kind: "summary" },
  ]) expect(demoResultSchema.safeParse(invalid).success).toBe(false);
});

test("failed demo calls do not invent results or expose exception details", async () => {
  const f = fixture();
  f.fail();
  const response = await f.route.POST(f.request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("Private infrastructure detail");
  expect(f.calls()).toBe(1);
  expect(f.reservations()).toBe(1);
});

test("ten-call budget persists across module reloads and concurrent reservations cannot exceed it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clamp-ai-budget-"));
  try {
    const load = () => policyRuntime({}, { process: { cwd: () => root } })
      .load<typeof import("../src/modules/ai-demo/server/budget")>("src/modules/ai-demo/server/budget.ts");
    const budget = load();
    expect(await budget.remainingDemoRequests()).toBe(10);
    for (let index = 0; index < 9; index++) await budget.reserveDemoRequest();
    const attempts = await Promise.allSettled([budget.reserveDemoRequest(), load().reserveDemoRequest()]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await load().remainingDemoRequests()).toBe(0);
    await expect(Promise.resolve(load().reserveDemoRequest())).rejects.toThrow("exhausted");
    expect(JSON.parse(await readFile(path.join(root, ".local", "ai-demo-budget.json"), "utf8"))).toEqual({ used: 10 });
  } finally {
    await rm(root, { recursive: true });
  }
});

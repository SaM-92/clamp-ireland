import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import path from "node:path";
import ts from "typescript";
import * as schemas from "../src/modules/area-summaries/types";

const nativeRequire = createRequire(path.resolve("package.json"));
const uuid = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-09-22T10:00:00+00:00";
const spot = { latitude: 53.3, longitude: -6.2 };

function repository() {
  const calls: { role: string; name: string; args: unknown }[] = [];
  let result: { data: unknown; error: Error | null } = { data: null, error: null };
  const client = (role: string) => ({
    rpc: async (name: string, args: unknown) => {
      calls.push({ role, name, args });
      return result;
    },
  });
  const commonJs = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(path.resolve("src", "modules", "area-summaries", "server", "repository.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  runInNewContext(code, {
    module: commonJs, exports: commonJs.exports,
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name === "../types") return schemas;
      if (name === "./errors") return { AreaSummaryError: Error };
      if (name === "@/lib/supabase/server") return {
        createServiceRoleClient: () => client("service_role"),
        createAnonServerClient: () => client("anon"),
      };
      return nativeRequire(name);
    },
  });
  return {
    api: commonJs.exports as typeof import("../src/modules/area-summaries/server/repository"),
    calls,
    respond: (data: unknown, error: Error | null = null) => { result = { data, error }; },
  };
}

test("server source RPC requires complete typed data and propagates resource/database failures", async () => {
  const server = repository();
  server.respond({
    ...spot, radius_metres: 500, source_fingerprint: "a".repeat(64), source_count: 1, source_bytes: 7,
    oldest_source_created_at: timestamp, newest_source_created_at: timestamp,
    newest_source_reviewed_at: timestamp,
    sources: [{
      report_id: uuid, location_id: uuid, description: "Parking", created_at: timestamp,
      reviewed_at: timestamp, ...spot,
    }],
  });
  expect((await server.api.getAreaSummarySources(spot)).source_count).toBe(1);
  expect(server.calls).toEqual([{
    role: "service_role", name: "get_area_summary_sources", args: { p_lat: 53.3, p_lng: -6.2 },
  }]);
  server.respond(null, new Error("resource limit exceeded; no sources truncated"));
  await expect(Promise.resolve(server.api.getAreaSummarySources(spot))).rejects.toThrow("no sources truncated");
  server.respond(null);
  await expect(Promise.resolve(server.api.getAreaSummarySources(spot))).rejects.toThrow();
});

test("public reads use only anon RPC, reject private fields and do not hide failures as absence", async () => {
  const server = repository();
  expect(await server.api.getPublicAreaSummary(spot)).toBeNull();
  expect(server.calls[0]).toEqual({
    role: "anon", name: "get_public_area_summary", args: { p_lat: 53.3, p_lng: -6.2 },
  });
  const published = {
    id: uuid, ...spot, radius_metres: 500, sentence: "Reports mention parking permits.",
    source_count: 1, oldest_source_created_at: timestamp, newest_source_created_at: timestamp,
    newest_source_reviewed_at: timestamp, generated_at: timestamp, approved_at: timestamp,
    model: "gpt-5-mini", contract_version: "area-summary-v1",
  };
  server.respond(published);
  expect(await server.api.getPublicAreaSummary(spot)).toEqual(published);
  server.respond({ ...published, description_raw: "Private original" });
  await expect(Promise.resolve(server.api.getPublicAreaSummary(spot))).rejects.toThrow();
  server.respond(null, new Error("Database unavailable"));
  await expect(Promise.resolve(server.api.getPublicAreaSummary(spot))).rejects.toThrow("Database unavailable");
  expect(server.calls.every((call) => call.role === "anon")).toBe(true);
});

test("writes validate structured draft output and pass fingerprint/reviewer through service-only RPCs", async () => {
  const server = repository();
  server.respond(uuid);
  expect(await server.api.saveAreaSummaryDraft(spot, "a".repeat(64), {
    sentence: "Reports mention parking permits.",
  })).toBe(uuid);
  expect(server.calls[0]).toEqual({
    role: "service_role", name: "create_area_summary_draft",
    args: {
      p_lat: 53.3, p_lng: -6.2, p_source_fingerprint: "a".repeat(64),
      p_sentence: "Reports mention parking permits.",
    },
  });
  await expect(Promise.resolve(server.api.saveAreaSummaryDraft(spot, "a".repeat(64), {
    sentence: "Reports mention parking permits.", approved: true,
  }))).rejects.toThrow();
  await expect(Promise.resolve(server.api.saveAreaSummaryDraft(spot, "invalid", {
    sentence: "Reports mention parking permits.",
  }))).rejects.toThrow();
  expect(server.calls).toHaveLength(1);
  await server.api.reviewAreaSummary(uuid, uuid, "approved");
  expect(server.calls[1]).toEqual({
    role: "service_role", name: "review_area_summary",
    args: { p_id: uuid, p_reviewer: uuid, p_decision: "approved" },
  });
  server.respond(null, new Error("Area summary sources changed"));
  await expect(Promise.resolve(server.api.reviewAreaSummary(uuid, uuid, "approved"))).rejects.toThrow("sources changed");
  await expect(Promise.resolve(server.api.getPublicAreaSummary({ latitude: 91, longitude: 0 }))).rejects.toThrow();
  expect(server.calls).toHaveLength(3);
});

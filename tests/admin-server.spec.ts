import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { adminOverviewSchema } from "../src/modules/admin/types";
import { pendingReportsSchema } from "../src/modules/moderation/types";

const nativeRequire = createRequire(path.resolve("package.json"));

// Execute the real server modules without loading server-only into Playwright.
// Only their external auth/database/storage dependencies are replaced.
function loadServer<T>(file: string, dependencies: Record<string, unknown>, errors: unknown[] = []): T {
  const commonJs = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.resolve(file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, {
    module: commonJs, exports: commonJs.exports, Request, Response, Headers, Error,
    console: { error: (...args: unknown[]) => errors.push(args) },
    require: (id: string) => id === "server-only" ? {} : id in dependencies ? dependencies[id] : nativeRequire(id),
  });
  return commonJs.exports as T;
}

test("overview route gates all reads through real requireAdmin and never substitutes zero on failure", async () => {
  let user: { id: string } | null = null;
  let admin = false;
  let fail = false;
  let reads = 0;
  const errors: unknown[] = [];
  const auth = loadServer<typeof import("../src/modules/auth/lib/requireAdmin")>(
    "src/modules/auth/lib/requireAdmin.ts", {
      "./adminSession": {
        adminSessionSettings: () => ({ configured: true, ids: ["ordinary-verified-user"] }),
        isAdminSameOrigin: () => true,
      },
      "@/lib/supabase/server": {
        getUserFromRequest: async () => user,
        createServiceRoleClient: () => ({
          from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: admin, is_banned: false } }) }) }) }),
        }),
      },
    },
  );
  const counts = { pending: 7, published: 11, rejected: 3, totalReports: 21, totalUsers: 6 };
  const route = loadServer<typeof import("../apps/admin/src/app/api/admin/overview/route")>(
    "apps/admin/src/app/api/admin/overview/route.ts", {
      "@/modules/auth/lib/requireAdmin": auth,
      "@/modules/admin/server/overview": {
        getAdminOverview: async () => {
          reads++;
          if (fail) throw new Error("database offline");
          return counts;
        },
      },
    }, errors,
  );
  const request = new Request("http://localhost/api/admin/overview", { headers: { Authorization: "Bearer fixture" } });
  expect((await route.GET(request)).status).toBe(403);
  user = { id: "ordinary-verified-user" };
  expect((await route.GET(request)).status).toBe(403);
  expect(reads).toBe(0);
  admin = true;
  const response = await route.GET(request);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("vary")).toContain("Authorization");
  expect(await response.json()).toEqual(counts);
  fail = true;
  const failed = await route.GET(request);
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: expect.any(String) });
  expect(errors).toHaveLength(1);
});

test("overview counts all rows exactly with explicit removed-report semantics", async () => {
  const tables: Record<string, Record<string, unknown>[]> = {
    reports: [
      { moderation_status: "pending", is_removed: false },
      { moderation_status: "pending", is_removed: true },
      { moderation_status: "published", is_removed: false },
      { moderation_status: "published", is_removed: false },
      { moderation_status: "published", is_removed: true },
      { moderation_status: "rejected", is_removed: true },
    ],
    profiles: [{ id: "one" }, { id: "two" }, { id: "three" }],
  };
  let failure: "none" | "error" | "missing" = "none";
  const server = loadServer<typeof import("../src/modules/admin/server/overview")>(
    "src/modules/admin/server/overview.ts", {
      "../types": { adminOverviewSchema },
      "@/lib/supabase/server": {
        createServiceRoleClient: () => ({
          from: (table: string) => {
            let rows = tables[table];
            const query = {
              select: (column: string, options: unknown) => {
                expect(column).toBe("id");
                expect(options).toEqual({ count: "exact", head: true });
                return query;
              },
              eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return query; },
              then: (resolve: (result: unknown) => unknown) => Promise.resolve({
                count: failure === "missing" ? null : rows.length,
                error: failure === "error" ? new Error("count failed") : null,
              }).then(resolve),
            };
            return query;
          },
        }),
      },
    },
  );
  expect(await server.getAdminOverview()).toEqual({ pending: 1, published: 2, rejected: 1, totalReports: 6, totalUsers: 3 });
  failure = "error";
  await expect(Promise.resolve(server.getAdminOverview())).rejects.toThrow("count failed");
  failure = "missing";
  await expect(Promise.resolve(server.getAdminOverview())).rejects.toThrow("count was not returned");
});

test("private signing failures are explicit and cannot be approved through the repository", async () => {
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    location_id: "00000000-0000-4000-8000-000000000002",
    reporter_type: "witness", description: "Test private report",
    created_at: "2026-09-22T10:00:00+00:00", has_image: true, image_url: "private/photo.jpg",
  };
  let updates = 0;
  const errors: unknown[] = [];
  const query = {
    select: () => query, eq: () => query,
    order: async () => ({ data: [row], error: null }),
    single: async () => ({ data: row, error: null }),
    update: () => { updates++; return query; },
  };
  const repository = loadServer<typeof import("../src/modules/moderation/server/repository")>(
    "src/modules/moderation/server/repository.ts", {
      "../types": { pendingReportsSchema },
      "@/lib/supabase/server": { createServiceRoleClient: () => ({ from: () => query }) },
      "@/modules/reports/server/imageStorage": { getSignedImageUrl: async () => { throw new Error("Storage unavailable"); } },
      "@/modules/scoring": { recomputeLocationScore: async () => {} },
    }, errors,
  );
  const reports = await repository.listPendingReports();
  expect(reports[0].hasImage).toBe(true);
  expect(reports[0].imageUrl).toBeNull();
  expect(reports[0].imageError).toContain("Approval is blocked");
  expect(errors).toHaveLength(1);
  await expect(Promise.resolve(repository.approveReport(row.id, "Reviewed note", "admin"))).rejects.toThrow("Storage unavailable");
  expect(updates).toBe(0);
});

test("image signer throws on storage failure and missing signed URL", async () => {
  let result: { data: { signedUrl?: string } | null; error: Error | null } = { data: null, error: new Error("Signing failed") };
  const storage = loadServer<typeof import("../src/modules/reports/server/imageStorage")>(
    "src/modules/reports/server/imageStorage.ts", {
      "@/lib/supabase/server": {
        createServiceRoleClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => result }) } }),
      },
    },
  );
  await expect(Promise.resolve(storage.getSignedImageUrl("private/file"))).rejects.toThrow("Signing failed");
  result = { data: {}, error: null };
  const missingUrl = Promise.resolve(storage.getSignedImageUrl("private/file"));
  await expect(missingUrl).rejects.toThrow("did not return");
  result = { data: { signedUrl: "https://example.test/private?token=test" }, error: null };
  expect(await storage.getSignedImageUrl("private/file")).toBe(result.data?.signedUrl);
});

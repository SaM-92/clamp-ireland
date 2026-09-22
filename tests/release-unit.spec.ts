import { expect, test } from "@playwright/test";
import { releaseMetadata } from "../src/modules/release/metadata";
import { GET as publicHealth } from "../src/app/api/health/route";
import { GET as adminHealth } from "../apps/admin/src/app/api/health/route";

test("release metadata allows only a stable version and full commit or explicit local marker", () => {
  expect(releaseMetadata("1.2.3", "a".repeat(40))).toEqual({ version: "1.2.3", sha: "a".repeat(40) });
  expect(releaseMetadata("0.1.0", "local")).toEqual({ version: "0.1.0", sha: "local" });
  for (const version of ["", "01.2.3", "1.2", "1.2.3\n", "https://private.invalid"]) {
    expect(() => releaseMetadata(version, "local")).toThrow();
  }
  for (const sha of ["", "latest", "abcd", "A".repeat(40), "private-resource-id"]) {
    expect(() => releaseMetadata("1.2.3", sha)).toThrow();
  }
});

test("health surfaces have exact minimal projections, no cache and no infrastructure dependencies", async () => {
  const response = publicHealth();
  const value = await response.json();
  expect(Object.keys(value).sort()).toEqual(["sha", "status", "version"]);
  expect(value.status).toBe("ok");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const admin = adminHealth();
  expect(await admin.json()).toEqual({ status: "ok" });
  expect(admin.headers.get("cache-control")).toBe("private, no-store");
  expect(admin.headers.get("x-robots-tag")).toBe("noindex");
});

import { expect, test } from "@playwright/test";
import { policyRuntime } from "./helpers/content-policy-runtime";

const owner = "20000000-0000-4000-8000-000000000001";
const evidence = `reports/${owner}/30000000-0000-4000-8000-000000000001.webp`;
const processed = new Uint8Array(Buffer.from("RIFF0000WEBP"));

function fixture(overrides: Record<string, unknown> = {}) {
  const state = {
    uploads: [] as unknown[][], deletes: [] as string[],
    keys: 0, reads: 0, credentials: [] as string[], sas: [] as Record<string, unknown>[],
    missing: false, signature: "sp=r&sig=synthetic", keyFailure: false, uploadFailure: false,
  };
  class Storage {
    constructor(public url: string, _credential: unknown, public options: unknown) {
      expect(url).toBe("https://fixtureaccount.blob.core.windows.net");
      expect(options).toEqual({ retryOptions: { maxTries: 1 } });
    }
    getContainerClient(container: string) {
      expect(container).toBe("report-images");
      return { getBlockBlobClient: (path: string) => ({
        url: `${this.url}/${container}/${path}`,
        getProperties: async () => { state.reads++; if (state.missing) throw new Error("Missing photo"); },
        uploadData: async (...args: unknown[]) => {
          state.uploads.push(args);
          if (state.uploadFailure) throw new Error("Upload failed");
        },
        deleteIfExists: async () => { state.deletes.push(path); },
      }) };
    }
    async getUserDelegationKey() {
      state.keys++;
      if (state.keyFailure) throw new Error("Delegation failed");
      return { value: "synthetic" };
    }
  }
  const runtime = policyRuntime({
    "@/lib/env": { env: { AZURE_STORAGE_ACCOUNT_NAME: "fixtureaccount", AZURE_STORAGE_AUTH_MODE: "managed-identity", NODE_ENV: "production", ...overrides } },
    "@azure/identity": {
      ManagedIdentityCredential: class { constructor() { state.credentials.push("managed-identity"); } },
      AzureCliCredential: class { constructor() { state.credentials.push("azure-cli"); } },
    },
    "@azure/storage-blob": {
      BlobServiceClient: Storage, BlobSASPermissions: { parse: (s: string) => s }, SASProtocol: { Https: "https" },
      generateBlobSASQueryParameters: (options: Record<string, unknown>) => {
        state.sas.push(options);
        return { toString: () => state.signature };
      },
    },
  });
  return { ...runtime, state, storage: runtime.load<typeof import("../src/modules/reports/server/imageStorage")>("src/modules/reports/server/imageStorage.ts") };
}

test("uploads only processed bytes using generated names, private headers and no overwrite", async () => {
  const f = fixture();
  const path = await f.storage.uploadReportImage(processed, owner);
  expect(path).toMatch(new RegExp(`^reports/${owner}/[0-9a-f-]+\\.webp$`));
  expect(f.state.credentials).toEqual(["managed-identity"]);
  expect(f.state.uploads).toEqual([[processed, expect.objectContaining({
    concurrency: 1, conditions: { ifNoneMatch: "*" },
    blobHTTPHeaders: { blobContentType: "image/webp", blobCacheControl: "private, no-store" },
  })]]);
  await f.storage.deleteReportImage(path);
  expect(f.state.deletes).toEqual([path]);
});

test("moderator signatures verify existence, are read-only HTTPS and at most ten minutes", async () => {
  const f = fixture();
  const before = Date.now();
  const urls = await Promise.all([f.storage.getSignedImageUrl(evidence), f.storage.getSignedImageUrl(evidence, 60)]);
  expect(urls[0]).toContain(`/report-images/${evidence}?sp=r`);
  expect(f.state.reads).toBe(2);
  expect(f.state.keys).toBe(1);
  for (const params of f.state.sas) {
    expect(params).toMatchObject({ permissions: "r", protocol: "https", blobName: evidence, cacheControl: "private, no-store" });
    expect(Number(params.expiresOn)).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(Number(params.expiresOn)).toBeGreaterThan(before);
  }
  for (const seconds of [0, 601, 1.5, NaN]) {
    await expect(Promise.resolve(f.storage.getSignedImageUrl(evidence, seconds))).rejects.toThrow("ten minutes");
  }
  for (const path of ["../private", "https://other.invalid", evidence.replace("reports/", "other/")]) {
    await expect(Promise.resolve(f.storage.getSignedImageUrl(path))).rejects.toThrow("Invalid");
    await expect(Promise.resolve(f.storage.deleteReportImage(path))).rejects.toThrow("Invalid");
  }
});

test("missing blobs and signing failures never create approval-shaped success", async () => {
  const f = fixture();
  f.state.missing = true;
  await expect(Promise.resolve(f.storage.getSignedImageUrl(evidence))).rejects.toThrow("Missing photo");
  expect(f.state.keys).toBe(0);
  f.state.missing = false;
  f.state.keyFailure = true;
  await expect(Promise.resolve(f.storage.getSignedImageUrl(evidence))).rejects.toThrow("Delegation failed");
  f.state.keyFailure = false;
  f.state.signature = "";
  await expect(Promise.resolve(f.storage.getSignedImageUrl(evidence))).rejects.toThrow("did not return");
  expect(f.state.keys).toBe(2);
});

test("missing configuration and deployed CLI credentials fail closed before uploading", async () => {
  for (const settings of [{ AZURE_STORAGE_ACCOUNT_NAME: "" }, { AZURE_STORAGE_AUTH_MODE: "azure-cli" }, { AZURE_STORAGE_AUTH_MODE: "keys" }]) {
    const f = fixture(settings);
    await expect(Promise.resolve(f.storage.uploadReportImage(processed, owner))).rejects.toThrow();
    expect(f.state.uploads).toEqual([]);
  }
  const local = fixture({ NODE_ENV: "development", AZURE_STORAGE_AUTH_MODE: "azure-cli" });
  await local.storage.uploadReportImage(processed, owner);
  expect(local.state.credentials).toEqual(["azure-cli"]);
});

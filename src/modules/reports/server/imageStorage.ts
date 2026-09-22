import "server-only";
import { randomUUID } from "node:crypto";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import {
  BlobServiceClient, BlobSASPermissions, SASProtocol, generateBlobSASQueryParameters,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { env } from "@/lib/env";
import { PHOTO_LIMITS } from "@/modules/photos/policy";

const CONTAINER = "report-images";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const evidencePath = new RegExp(`^reports/${uuid}/${uuid}\\.webp$`, "i");
let service: BlobServiceClient | undefined;
let delegation: { expiresAt: number; key: Promise<UserDelegationKey> } | undefined;

function client(): BlobServiceClient {
  if (service) return service;
  if (!/^[a-z0-9]{3,24}$/.test(env.AZURE_STORAGE_ACCOUNT_NAME)) {
    throw new Error("Private Azure Blob storage is not configured.");
  }
  const mode = env.AZURE_STORAGE_AUTH_MODE;
  if (!["managed-identity", "azure-cli"].includes(mode) || (mode === "azure-cli" && env.NODE_ENV === "production")) {
    throw new Error("Private storage requires managed identity in deployed environments.");
  }
  const credential = mode === "azure-cli"
    ? new AzureCliCredential({ processTimeoutInMs: 7_000 })
    : new ManagedIdentityCredential(env.AZURE_CLIENT_ID ? { clientId: env.AZURE_CLIENT_ID } : {});
  service = new BlobServiceClient(`https://${env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential, {
    retryOptions: { maxTries: 1 },
  });
  return service;
}

function blob(path: string) {
  if (!evidencePath.test(path)) throw new Error("Invalid private evidence path.");
  return client().getContainerClient(CONTAINER).getBlockBlobClient(path);
}

export async function uploadReportImage(bytes: Uint8Array, ownerId: string): Promise<string> {
  if (!new RegExp(`^${uuid}$`, "i").test(ownerId)) throw new Error("Invalid evidence owner.");
  const storage = client();
  if (bytes.byteLength === 0 || bytes.byteLength > PHOTO_LIMITS.storedBytes) throw new Error("Invalid processed photo size.");
  if (Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF"
    || Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WEBP") throw new Error("Expected processed WebP evidence.");
  const path = `reports/${ownerId}/${randomUUID()}.webp`;
  const target = storage.getContainerClient(CONTAINER).getBlockBlobClient(path);
  try {
    await target.uploadData(bytes, {
      abortSignal: AbortSignal.timeout(15_000),
      concurrency: 1,
      conditions: { ifNoneMatch: "*" },
      blobHTTPHeaders: { blobContentType: "image/webp", blobCacheControl: "private, no-store" },
    });
  } catch (error) {
    console.error("[Photos] upload failed; no report insert was attempted");
    throw error;
  }
  return path;
}

export async function deleteReportImage(path: string): Promise<void> {
  await blob(path).deleteIfExists({ abortSignal: AbortSignal.timeout(15_000) });
}

/** Callers must authorize an administrator before requesting a private read-only URL. */
export async function getSignedImageUrl(path: string, expiresInSeconds = 600): Promise<string> {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 600) {
    throw new Error("Private evidence URLs must expire within ten minutes.");
  }
  const evidence = blob(path);
  await evidence.getProperties({ abortSignal: AbortSignal.timeout(15_000) });
  const now = Date.now();
  if (!delegation || delegation.expiresAt < now + 15 * 60_000) {
    const expiresAt = now + 60 * 60_000;
    const key = client().getUserDelegationKey(new Date(now - 5 * 60_000), new Date(expiresAt), {
      abortSignal: AbortSignal.timeout(15_000),
    });
    const entry = { expiresAt, key };
    delegation = entry;
    void key.catch(() => {
      if (delegation === entry) delegation = undefined;
    });
  }
  const signed = generateBlobSASQueryParameters({
    containerName: CONTAINER, blobName: path,
    permissions: BlobSASPermissions.parse("r"), protocol: SASProtocol.Https,
    startsOn: new Date(now - 5 * 60_000), expiresOn: new Date(now + expiresInSeconds * 1000),
    cacheControl: "private, no-store", contentType: "image/webp",
  }, await delegation.key, env.AZURE_STORAGE_ACCOUNT_NAME).toString();
  if (!signed) throw new Error("Storage did not return a private image signature.");
  return `${evidence.url}?${signed}`;
}

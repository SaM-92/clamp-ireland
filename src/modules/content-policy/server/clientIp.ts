import "server-only";
import { createHash } from "node:crypto";

/**
 * Azure Container Apps' ingress sets X-Forwarded-For with the real client IP
 * first, followed by any intermediate proxies.
 */
export function getClientIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || undefined;
}

/**
 * We only need a stable-enough value to rate-limit anonymous submissions per
 * visitor - never the raw IP itself, so it is hashed rather than stored or
 * logged verbatim.
 */
export function getClientIpHash(request: Request): string {
  return createHash("sha256").update(getClientIp(request) ?? "unknown").digest("hex");
}

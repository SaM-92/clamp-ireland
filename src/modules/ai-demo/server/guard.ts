import "server-only";
import { env } from "@/lib/env";

export function localAiDemoEnabled(): boolean {
  return env.NODE_ENV === "development" && env.ENABLE_LOCAL_AI_DEMO === true;
}

export function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function allowLocalDemoRequest(request: Request): boolean {
  if (!localAiDemoEnabled()) return false;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  return isLoopbackOrigin(url.origin) && origin === url.origin &&
    request.headers.get("host") === url.host &&
    (!request.headers.has("sec-fetch-site") || request.headers.get("sec-fetch-site") === "same-origin");
}

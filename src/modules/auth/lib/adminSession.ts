import "server-only";
import { env } from "@/lib/env";
import { parseAdminIds, parseAdminOrigin } from "./adminPolicy";
import { authSettings, sameOrigin } from "../server/session";

export function adminSessionSettings() {
  const origin = parseAdminOrigin(env.ADMIN_SITE_URL);
  const ids = parseAdminIds(env.ADMIN_ALLOWED_USER_IDS);
  const secure = origin?.startsWith("https:") === true;
  return {
    origin, ids, secure,
    cookieName: secure ? "__Host-clamp-admin-session" : "clamp-admin-session",
    configured: Boolean(origin && ids && authSettings("admin").configured),
  };
}

export function isAdminSameOrigin(request: Request): boolean {
  return sameOrigin(request, "admin");
}

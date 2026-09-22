import "server-only";
import { env, isSupabaseConfigured } from "@/lib/env";
import { parseAdminIds, parseAdminOrigin } from "./adminPolicy";

export function adminSessionSettings() {
  const origin = parseAdminOrigin(env.ADMIN_SITE_URL);
  const ids = parseAdminIds(env.ADMIN_ALLOWED_USER_IDS);
  const secure = origin?.startsWith("https:") === true;
  return {
    origin, ids, secure,
    cookieName: secure ? "__Host-clamp-admin-session" : "clamp-admin-session",
    configured: Boolean(origin && ids && isSupabaseConfigured && env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

export function isAdminSameOrigin(request: Request): boolean {
  const { origin } = adminSessionSettings();
  return Boolean(origin && request.headers.get("origin") === origin &&
    request.headers.get("sec-fetch-site") !== "cross-site");
}

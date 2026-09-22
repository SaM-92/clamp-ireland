import "server-only";
import { createServiceRoleClient, getUserFromRequest } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { adminSessionSettings, isAdminSameOrigin } from "./adminSession";

/**
 * Every admin page and API requires the explicit two-account allowlist,
 * confirmed identity and a non-banned administrator profile.
 */
export async function requireAdmin(request: Request): Promise<{ id: string } | null> {
  const settings = adminSessionSettings();
  if (!settings.configured || !settings.ids) return null;
  let identityRequest = request;
  if (!request.headers.has("authorization")) {
    if (!["GET", "HEAD"].includes(request.method) && !isAdminSameOrigin(request)) return null;
    const cookie = new NextRequest(request.url, { headers: request.headers }).cookies.get(settings.cookieName)?.value;
    if (!cookie) return null;
    identityRequest = new Request(request.url, { headers: { Authorization: `Bearer ${cookie}` } });
  }
  const user = await getUserFromRequest(identityRequest);
  if (!user || !settings.ids.includes(user.id)) return null;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin, is_banned")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("[Admin access] profile lookup failed", error.code);
    return null;
  }
  if (data?.is_admin !== true || data.is_banned !== false) return null;
  return user;
}

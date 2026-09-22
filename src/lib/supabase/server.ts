import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Privileged, server-only Supabase client using the service role key. This
 * bypasses Row Level Security, so it must never be imported into client
 * components — the `server-only` import above enforces that at build time.
 * Used for writes the client is deliberately not allowed to do directly
 * (creating locations/reports, moderation actions) so API routes can run
 * business logic (text softening, moderation gating, score recompute)
 * before anything hits the database.
 */
export function createServiceRoleClient(): SupabaseClient {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — see .env.example. This key is required for any server-side write."
    );
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Server-side client using the anon key, for public reads that should
 * respect Row Level Security exactly as an anonymous browser would see it.
 */
export function createAnonServerClient(): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Resolves the signed-in user from a request's `Authorization: Bearer
 * <access_token>` header. Every write endpoint calls this first — there is
 * no anonymous posting, which is the app's primary anti-bot measure (see
 * docs/00-product-plan.md, "Anti-bot / anti-abuse approach").
 */
export async function getUserFromRequest(
  request: Request
): Promise<{ id: string; email: string | null } | null> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabase = createAnonServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email_confirmed_at) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

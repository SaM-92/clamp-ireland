"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let browserClient: SupabaseClient | null = null;

/**
 * Browser-side Supabase client (anon key only — safe to expose). Used for
 * auth (magic link sign-in) and reading the current session/access token.
 * Lazily created so importing this module never throws when env vars are
 * still unset during local scaffolding.
 */
export function createBrowserClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return browserClient;
}

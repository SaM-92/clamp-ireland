"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";

const NOT_CONFIGURED_ERROR =
  "Sign-in isn't set up yet — this deployment has no Supabase project configured. See README.md.";

/** Sends a passwordless magic link to the given email (Supabase Auth). */
export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_ERROR };
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const supabase = createBrowserClient();
  await supabase.auth.signOut();
}

/** The current session's access token, sent as a Bearer token on write requests. */
export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = createBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

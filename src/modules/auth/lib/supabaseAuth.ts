"use client";

import { createBrowserClient } from "@/lib/supabase/client";

/** Sends a passwordless magic link to the given email (Supabase Auth). */
export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
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
  const supabase = createBrowserClient();
  await supabase.auth.signOut();
}

/** The current session's access token, sent as a Bearer token on write requests. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = createBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { env, isSupabaseConfigured } from "@/lib/env";

const NOT_CONFIGURED_ERROR =
  "Sign-in isn't set up yet — this deployment has no Supabase project configured. See README.md.";

export async function signInWithEmail(email: string, password: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_ERROR };
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { error: error?.message ?? null };
}

export async function signUpWithEmail(email: string, password: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_ERROR };
  const { error } = await createBrowserClient().auth.signUp({
    email, password,
    options: { emailRedirectTo: `${window.location.origin}/auth/sign-in` },
  });
  return { error: error?.message ?? null };
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_ERROR };
  if (!env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED) return { error: "Google sign-in is not configured yet." };
  const { error } = await createBrowserClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/username` },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) throw new Error(NOT_CONFIGURED_ERROR);
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** The current session's access token, sent as a Bearer token on write requests. */
export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = createBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

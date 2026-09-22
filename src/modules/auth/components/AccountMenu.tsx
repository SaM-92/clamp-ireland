"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createBrowserClient } from "@/lib/supabase/client";
import { signOut } from "../lib/supabaseAuth";

export function AccountMenu() {
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    const client = createBrowserClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(Boolean(session));
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function handleSignOut() {
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-menu">
      {signedIn
        ? <button className="nav-button" disabled={busy} onClick={handleSignOut}>{busy ? "Signing out..." : "Sign out"}</button>
        : <Link className="nav-button" href="/auth/sign-in">Sign in</Link>}
      {error && <p className="account-error" role="alert">{error}</p>}
    </div>
  );
}

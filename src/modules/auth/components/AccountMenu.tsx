"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession, signOut, subscribeAuth } from "../lib/session";

export function AccountMenu() {
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const refresh = () => {
      void getSession(controller.signal).then((session) => {
        if (active) { setSignedIn(session.signedIn); setError(null); }
      }).catch(() => { if (active) setError("Could not verify your session."); });
    };
    refresh();
    const unsubscribe = subscribeAuth(refresh);
    return () => { active = false; controller.abort(); unsubscribe(); };
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
        ? <>
          <Link className="nav-button" href="/auth/username?edit=1">Your username</Link>
          <button className="nav-button" disabled={busy} onClick={handleSignOut}>{busy ? "Signing out..." : "Sign out"}</button>
        </>
        : <Link className="nav-button" href="/auth/sign-in">Sign in</Link>}
      {error && <p className="account-error" role="alert">{error}</p>}
    </div>
  );
}

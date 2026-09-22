"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function AdminSessionBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  const check = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
      if (current !== generation.current) return;
      if (response.status === 401 || response.status === 403) {
        setChecking(true);
        window.location.replace("/auth/sign-in");
        return;
      }
      if (!response.ok) throw new Error("Could not verify your administrator session.");
      setError(null); setChecking(false);
    } catch {
      if (current !== generation.current) return;
      setError("Cannot verify administrator access. Private content is hidden; check your connection and retry.");
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    const requests = generation;
    const channel = new BroadcastChannel("clamp-admin-session");
    channel.onmessage = () => { generation.current++; setChecking(true); window.location.replace("/auth/sign-in"); };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const timer = window.setInterval(onVisible, 60_000);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      requests.current++;
      channel.close(); window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);
  async function signOut() {
    generation.current++;
    setChecking(true);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Sign-out failed.");
      const channel = new BroadcastChannel("clamp-admin-session");
      channel.postMessage("signed-out"); channel.close();
      window.location.replace("/auth/sign-in");
    } catch {
      setError("Could not sign out. Check your connection and retry.");
      setChecking(false);
    }
  }
  return <>
    <header className="site-header"><strong>Clamp / Private administration</strong>
      <button className="button button-surface" disabled={checking} onClick={() => void signOut()}>Sign out</button>
    </header>
    {error ? <main id="main-content" className="auth-shell">
      <p className="form-error" role="alert">{error}</p>
      <button className="button button-surface" onClick={() => void check()}>Retry session check</button>
    </main> : checking ? <main id="main-content" className="auth-shell" role="status">Verifying administrator access...</main> : children}
  </>;
}

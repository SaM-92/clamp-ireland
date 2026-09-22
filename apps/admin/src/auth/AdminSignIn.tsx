"use client";

import { useState } from "react";

export function AdminSignIn({ configured }: { configured: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fields.get("email"), password: fields.get("password") }),
      });
      if (!response.ok) throw new Error(response.status === 503
        ? "Administrator sign-in is not configured."
        : "Access denied. Check your credentials and approved administrator access.");
      window.location.replace("/admin");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in. Please retry.");
      setBusy(false);
    }
  }
  return <>
    {!configured && <p className="form-error" role="alert">Administrator sign-in is not configured. Access stays locked until the owner configures the backend and both approved accounts.</p>}
    <form onSubmit={submit} className="report-form">
      <label className="field">Email
        <input name="email" type="email" autoComplete="username" required maxLength={320} disabled={!configured || busy} />
      </label>
      <label className="field">Password
        <input name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={!configured || busy} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary" disabled={!configured || busy}>{busy ? "Signing in..." : "Sign in"}</button>
    </form>
    <p className="field-hint">No administrator registration or local dashboard bypass is available. Sessions expire after at most one hour.</p>
  </>;
}

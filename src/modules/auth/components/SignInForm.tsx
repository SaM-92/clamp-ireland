"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { env, isSupabaseConfigured } from "@/lib/env";
import { Icon } from "@/lib/components/Icon";
import { signInWithEmail, signInWithGoogle, signUpWithEmail } from "../lib/supabaseAuth";

export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = mode === "signup"
        ? await signUpWithEmail(email, password)
        : await signInWithEmail(email, password);
      if (result.error) throw new Error(result.error);
      if (mode === "signup") {
        setPassword("");
        setConfirmationSent(true);
      } else {
        router.replace("/auth/username");
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithGoogle();
      if (result.error) throw new Error(result.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  if (confirmationSent) return (
    <div className="auth-success" role="status">
      <Icon name="check" width="28" height="28" />
      <strong>Check your email.</strong>
      <p>If this address can be registered, a confirmation link is on its way. Confirm it once, then sign in and choose a public pseudonym.</p>
      <button className="button button-surface" onClick={() => { setConfirmationSent(false); setMode("signin"); }}>Back to sign in</button>
    </div>
  );

  return (
    <>
      {env.NEXT_PUBLIC_REGISTRATION_ENABLED ? <div className="auth-tabs" role="group" aria-label="Account action">
        <button aria-pressed={mode === "signin"} disabled={busy} onClick={() => { setMode("signin"); setError(null); }}>Sign in</button>
        <button aria-pressed={mode === "signup"} disabled={busy} onClick={() => { setMode("signup"); setError(null); }}>Create account</button>
      </div> : <p className="field-hint">Registration is closed. This is an invitation-only test deployment.</p>}
      <form onSubmit={handleSubmit} className="auth-form">
        <label className="field">Email address
          <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
        </label>
        <label className="field">Password
          <input type="password" required minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password} onChange={(event) => setPassword(event.target.value)} />
          {mode === "signup" && <span className="field-hint">At least 8 characters. You only need to confirm your email once.</span>}
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!isSupabaseConfigured && <p className="field-hint">Accounts are not connected yet. You can still explore the map.</p>}
        <button className="button button-primary" type="submit" disabled={busy || !isSupabaseConfigured}>
          {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      {env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED && (
        <>
          <div className="auth-divider">or</div>
          <button className="button button-surface w-full" disabled={busy || !isSupabaseConfigured} onClick={googleSignIn}>Continue with Google</button>
        </>
      )}
    </>
  );
}

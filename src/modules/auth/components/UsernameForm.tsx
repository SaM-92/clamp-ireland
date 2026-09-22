"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "../lib/supabaseAuth";
import { validateContent } from "@/modules/content-policy/policy";

export function UsernameForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (active) setNeedsSignIn(true);
          return;
        }
        const response = await fetch("/api/profile/username", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        const body = await response.json();
        if (response.status === 401 && active) setNeedsSignIn(true);
        if (!response.ok) throw new Error(body.error ?? "Could not load your username. Please retry.");
        if (active) setUsername(body.username ?? "");
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your username. Please retry.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const normalized = validateContent("username", username);
      const token = await getAccessToken();
      if (!token) {
        setNeedsSignIn(true);
        throw new Error("Sign in with a confirmed account first.");
      }
      const response = await fetch("/api/profile/username", {
        method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalized }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save your username. Please retry.");
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your username. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Loading your account...</p>;
  if (needsSignIn) return (
    <div className="auth-success">
      <p>Confirm your email and sign in before choosing a public username.</p>
      <Link className="button button-primary" href="/auth/sign-in">Sign in</Link>
    </div>
  );
  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field">Public username
        <input required minLength={3} maxLength={24} pattern="[A-Za-z][A-Za-z0-9_]{2,23}"
          autoComplete="nickname" autoCapitalize="none" spellCheck={false}
          value={username} onChange={(event) => setUsername(event.target.value)} placeholder="river_walker" />
        <span className="field-hint">3 to 24 letters, numbers or underscores, starting with a letter. Use a pseudonym, not your real name or email.</span>
      </label>
      <p className="field-hint">Usernames are checked for profanity, abuse and impersonation before being saved. Your Google or email account name is never used as an approved public username.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary" disabled={busy} type="submit">{busy ? "Checking username..." : "Save username and continue"}</button>
      <Link className="button button-surface" href="/">Browse without posting</Link>
    </form>
  );
}

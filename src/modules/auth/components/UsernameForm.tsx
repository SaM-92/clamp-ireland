"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestUsername, UsernameRequestError } from "../lib/username";
import { validateContent } from "@/modules/content-policy/policy";

export function UsernameForm({ edit = false }: { edit?: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      let redirecting = false;
      try {
        const identity = await requestUsername({ signal: controller.signal });
        if (!active) return;
        if (!identity.needsOnboarding && !edit) {
          redirecting = true;
          router.replace("/");
        } else {
          setUsername(identity.username ?? "");
          setSavedUsername(identity.username);
        }
      } catch (cause) {
        if (active && cause instanceof UsernameRequestError && cause.status === 401) setNeedsSignIn(true);
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your username. Please retry.");
      } finally {
        if (active && !redirecting) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); saveController.current?.abort(); };
  }, [edit, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    saveController.current = controller;
    try {
      const normalized = validateContent("username", username);
      if (normalized !== savedUsername) await requestUsername({ username: normalized, signal: controller.signal });
      if (controller.signal.aborted) return;
      router.replace("/");
      router.refresh();
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof UsernameRequestError && cause.status === 401) setNeedsSignIn(true);
        setError(cause instanceof Error ? cause.message : "Could not save your username. Please retry.");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      saveController.current = null;
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
      <Link className="button button-surface" href="/">Return to the map</Link>
    </form>
  );
}

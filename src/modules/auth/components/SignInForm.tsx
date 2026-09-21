"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { signInWithEmail } from "../lib/supabaseAuth";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("sending");
    const { error } = await signInWithEmail(email);
    if (error) {
      setErrorMessage(error);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return <p>Check your inbox for a sign-in link.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="rounded border p-2"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send magic link"}
      </button>
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
    </form>
  );
}

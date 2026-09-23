"use client";
import { z } from "zod";

export async function getSession(signal?: AbortSignal) {
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not verify your session. Please retry.");
  return z.strictObject({ configured: z.boolean(), signedIn: z.boolean() }).parse(await response.json());
}
export function subscribeAuth(listener: () => void) {
  window.addEventListener("clamp-auth-change", listener);
  window.addEventListener("focus", listener);
  return () => {
    window.removeEventListener("clamp-auth-change", listener);
    window.removeEventListener("focus", listener);
  };
}
export async function signOut() {
  const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Could not sign out. Please retry.");
  window.dispatchEvent(new Event("clamp-auth-change"));
}

"use client";

import { z } from "zod";
import { getAccessToken } from "./supabaseAuth";

const identitySchema = z.discriminatedUnion("needsOnboarding", [
  z.object({ username: z.null(), needsOnboarding: z.literal(true) }).strict(),
  z.object({ username: z.string().regex(/^[a-z][a-z0-9_]{2,23}$/), needsOnboarding: z.literal(false) }).strict(),
]);
const errorSchema = z.object({
  error: z.string().min(1).max(500), code: z.string().min(1).max(80).optional(),
}).strict();

export class UsernameRequestError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "UsernameRequestError";
  }
}

export async function requestUsername({ username, signal }: { username?: string; signal: AbortSignal }) {
  const saving = username !== undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  const timer = setTimeout(() => controller.abort(new UsernameRequestError(saving
    ? "Saving your username timed out. Reload your account before trying again."
    : "Loading your username timed out. Please reload to try again.")), saving ? 20_000 : 10_000);
  if (signal.aborted) abort();

  async function request() {
    controller.signal.throwIfAborted();
    const token = await getAccessToken();
    controller.signal.throwIfAborted();
    if (!token) throw new UsernameRequestError("Sign in with a confirmed account first.", 401);
    const response = await fetch("/api/profile/username", {
      method: saving ? "PUT" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(saving ? { "Content-Type": "application/json" } : {}) },
      body: saving ? JSON.stringify({ username }) : undefined,
      cache: "no-store", signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(body);
      throw new UsernameRequestError(parsed.success ? parsed.data.error : "Could not process your username request. Please retry.", response.status);
    }
    const parsed = identitySchema.safeParse(body);
    if (!parsed.success || (saving && (parsed.data.needsOnboarding || parsed.data.username !== username))) {
      throw new UsernameRequestError("The account service returned an invalid response. Reload your account before trying again.");
    }
    return parsed.data;
  }

  try {
    return await Promise.race([aborted, request()]);
  } catch (error) {
    if (error instanceof UsernameRequestError || signal.aborted) throw error;
    throw new UsernameRequestError(saving
      ? "Could not confirm your username was saved. Reload your account before trying again."
      : "Could not load your username. Please reload to try again.");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

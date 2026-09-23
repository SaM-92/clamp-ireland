import "server-only";
import { env } from "@/lib/env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verifies a Cloudflare Turnstile token server-side before trusting an
 * anonymous report submission. Turnstile is the bot-blocker that lets us
 * accept reports with no account/email at all - see docs/03? anonymous tier
 * design notes. Fails closed: any network/config problem is treated as "not
 * verified" rather than silently letting the submission through.
 */
export async function verifyTurnstileToken(token: string, remoteIp: string | undefined, signal?: AbortSignal): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY || !token) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch(VERIFY_URL, { method: "POST", body, signal });
    if (!response.ok) return false;
    const result = await response.json();
    return result?.success === true;
  } catch {
    console.error("[Turnstile] verification request failed");
    return false;
  }
}

import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ContentPolicyError, POLICY_UNAVAILABLE_MESSAGE } from "../policy";

export async function consumeContentPolicyAttempt(userId: string, signal?: AbortSignal): Promise<void> {
  let allowed: unknown;
  try {
    const { data, error } = await createServiceRoleClient(signal).rpc("consume_content_policy_attempt", { p_user_id: userId });
    if (error || typeof data !== "boolean") throw new Error("Policy capacity unavailable");
    allowed = data;
  } catch {
    throw new ContentPolicyError("content_policy_unavailable", 503, POLICY_UNAVAILABLE_MESSAGE);
  }
  if (!allowed) {
    throw new ContentPolicyError("content_policy_rate_limited", 429, "Content-check capacity has been reached. Nothing was submitted. Please try again later.");
  }
}

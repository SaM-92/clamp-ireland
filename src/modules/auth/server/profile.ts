import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertApprovedContent, type ApprovedContent } from "@/modules/content-policy/server/check";
import { ContentPolicyError, POLICY_UNAVAILABLE_MESSAGE } from "@/modules/content-policy/policy";

export interface PublicIdentity {
  username: string | null;
  needsOnboarding: boolean;
}

export class ProfileError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export async function getPublicIdentity(userId: string, signal?: AbortSignal): Promise<PublicIdentity> {
  const { data, error } = await createServiceRoleClient(signal).from("profiles")
    .select("display_name, username_policy_checked_at, is_banned").eq("id", userId).single();
  if (error || !data || typeof data.is_banned !== "boolean") {
    throw new ContentPolicyError("content_policy_unavailable", 503, POLICY_UNAVAILABLE_MESSAGE);
  }
  if (data.is_banned) throw new ProfileError("account_restricted", 403, "This account cannot submit content.");
  const approved = typeof data.username_policy_checked_at === "string"
    && typeof data.display_name === "string" && /^[a-z][a-z0-9_]{2,23}$/.test(data.display_name);
  return { username: approved ? data.display_name : null, needsOnboarding: !approved };
}

export async function requirePublicIdentity(userId: string, signal?: AbortSignal): Promise<void> {
  if ((await getPublicIdentity(userId, signal)).needsOnboarding) {
    throw new ProfileError("username_required", 409, "Choose a public username in your account before submitting a report.");
  }
}

export async function savePublicIdentity(userId: string, approval: ApprovedContent): Promise<PublicIdentity> {
  assertApprovedContent(approval, "username");
  const { data, error } = await createServiceRoleClient().rpc("set_approved_username", {
    p_user_id: userId, p_username: approval.text,
  });
  if (error?.code === "23505") throw new ProfileError("username_unavailable", 409, "That username is already in use. Please choose another.");
  if (error || data !== approval.text) {
    throw new ContentPolicyError("content_policy_unavailable", 503, "We could not confirm your username was saved. Reload your account before trying again.");
  }
  return { username: approval.text, needsOnboarding: false };
}

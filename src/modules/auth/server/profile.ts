import "server-only";
import { database } from "@/lib/db/server";
import { assertApprovedContent, type ApprovedContent } from "@/modules/content-policy/server/check";
import { ContentPolicyError, POLICY_UNAVAILABLE_MESSAGE } from "@/modules/content-policy/policy";

export interface PublicIdentity { username: string | null; needsOnboarding: boolean }
export class ProfileError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export async function getPublicIdentity(userId: string, signal?: AbortSignal): Promise<PublicIdentity> {
  signal?.throwIfAborted();
  const row = database().prepare("SELECT display_name,username_policy_checked_at,is_banned FROM profiles WHERE id=?").get(userId);
  if (!row) throw new ContentPolicyError("content_policy_unavailable", 503, POLICY_UNAVAILABLE_MESSAGE);
  if (row.is_banned !== 0) throw new ProfileError("account_restricted", 403, "This account cannot submit content.");
  const approved = typeof row.username_policy_checked_at === "string" &&
    typeof row.display_name === "string" && /^[a-z][a-z0-9_]{2,23}$/.test(row.display_name);
  return { username: approved && typeof row.display_name === "string" ? row.display_name : null, needsOnboarding: !approved };
}

export async function requirePublicIdentity(userId: string, signal?: AbortSignal): Promise<void> {
  if ((await getPublicIdentity(userId, signal)).needsOnboarding) {
    throw new ProfileError("username_required", 409, "Choose a public username in your account before submitting a report.");
  }
}

export async function savePublicIdentity(userId: string, approval: ApprovedContent): Promise<PublicIdentity> {
  assertApprovedContent(approval, "username");
  try {
    const result = database().prepare("UPDATE profiles SET display_name=?,username_policy_checked_at=? WHERE id=? AND is_banned=0")
      .run(approval.text, new Date().toISOString(), userId);
    if (result.changes !== 1) throw new ProfileError("account_restricted", 403, "This account cannot submit content.");
  } catch (error) {
    if (error && typeof error === "object" && "errcode" in error && error.errcode === 2067) {
      throw new ProfileError("username_unavailable", 409, "That username is already in use. Please choose another.");
    }
    console.error("[Profile] username save failed");
    throw error;
  }
  return { username: approval.text, needsOnboarding: false };
}

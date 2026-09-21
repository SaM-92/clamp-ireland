import "server-only";
import { createServiceRoleClient, getUserFromRequest } from "@/lib/supabase/server";

/**
 * Verifies the request's bearer token belongs to a signed-in user AND that
 * user's `profiles.is_admin` flag is set. Used to gate the moderation
 * endpoints — see docs/00-product-plan.md, "human-in-the-loop image
 * review". There is no self-service admin signup; grant `is_admin` by hand
 * in the database for now (small trusted-operator scale).
 */
export async function requireAdmin(request: Request): Promise<{ id: string } | null> {
  const user = await getUserFromRequest(request);
  if (!user) return null;

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!data?.is_admin) return null;
  return user;
}

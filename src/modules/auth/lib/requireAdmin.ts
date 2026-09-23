import "server-only";
import { eligibleAdmin, getUserFromRequest } from "../server/session";

/** Public cookies, bearer tokens and unlisted accounts cannot authorize the admin site. */
export async function requireAdmin(request: Request): Promise<{ id: string } | null> {
  const user = await getUserFromRequest(request, undefined, "admin");
  return user && (await eligibleAdmin(user.id)) ? user : null;
}

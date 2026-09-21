import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";

const BUCKET = "report-images";

/** Uploads a raw, unreviewed image to a private Storage bucket. */
export async function uploadReportImage(file: File, ownerPathPrefix: string): Promise<string> {
  const supabase = createServiceRoleClient();
  const extension = file.name.split(".").pop() ?? "jpg";
  const path = `${ownerPathPrefix}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return path;
}

/**
 * Returns a time-limited signed URL for a stored image. Callers MUST only
 * do this for reports whose `moderation_status === 'published'` — the
 * bucket is private specifically so an unreviewed image (which may show
 * faces/plates) is never reachable before a human has redacted it. See
 * docs/00-product-plan.md, "human-in-the-loop image review".
 */
export async function getSignedImageUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

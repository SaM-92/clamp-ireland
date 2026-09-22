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
 * Returns private evidence for an authenticated administrator's review.
 * Callers MUST enforce requireAdmin before signing unreviewed images.
 * Never expose these bearer URLs through public report endpoints.
 */
export async function getSignedImageUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Storage did not return a private image URL.");
  return data.signedUrl;
}

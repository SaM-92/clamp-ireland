import "server-only";
import { z } from "zod";
import { database, writeTransaction } from "@/lib/db/server";
import { getSignedImageUrl } from "@/modules/reports/server/imageStorage";
import { recomputeLocationScore } from "@/modules/scoring";
import { invalidateNearbyAreaSummaries } from "@/modules/area-summaries/server/repository";
import { pendingReportsSchema, type PendingReport } from "../types";

/** Text and photos awaiting human review. */
export async function listPendingReports(): Promise<PendingReport[]> {
  const db = await database();
  const data = await db.prepare(`SELECT id,location_id,reporter_type,description,has_image,image_url,created_at
    FROM reports WHERE moderation_status='pending' AND is_removed=0 ORDER BY created_at,id`).all();

  const reports = await Promise.all(
    (data ?? []).map(async (row) => {
      const hasImage = Boolean(row.has_image || row.image_url);
      let imageUrl: string | null = null;
      let imageError: string | null = null;
      if (hasImage) {
        try {
          if (!row.image_url) throw new Error("Report has photo evidence but no storage path.");
          imageUrl = await getSignedImageUrl(row.image_url as string, 600);
        } catch (error) {
          console.error("[Moderation] private image unavailable", row.id, error);
          imageError = "Private photo could not be signed or found. Approval is blocked. Reload the queue to retry, or reject the report.";
        }
      }
      return {
        id: row.id,
        locationId: row.location_id,
        reporterType: row.reporter_type,
        description: row.description ?? "",
        createdAt: row.created_at,
        hasImage, imageUrl, imageError,
      };
    })
  );
  return pendingReportsSchema.parse(reports);
}

/** Publish the reviewed wording without changing the private original. */
export async function approveReport(reportId: string, description: string, reviewerId: string) {
  const db0 = await database();
  const evidence = await db0.prepare(`SELECT has_image,image_url FROM reports
    WHERE id=? AND moderation_status='pending' AND is_removed=0`).get(reportId);
  if (!evidence) throw new Error("Only an existing pending report can be approved.");
  if (evidence.has_image || evidence.image_url) {
    if (!evidence.image_url) throw new Error("Cannot approve a report with missing photo evidence.");
    await getSignedImageUrl(evidence.image_url as string, 600);
  }
  return writeTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM profiles WHERE id=? AND is_admin=1 AND is_banned=0").get(reviewerId))) {
      throw new Error("An active human administrator is required.");
    }
    const data = await db.prepare(`UPDATE reports SET moderation_status='published',description=?,reviewed_at=?,reviewed_by=?
      OUTPUT inserted.id,inserted.location_id
      WHERE id=? AND moderation_status='pending' AND is_removed=0 AND (image_url = ? OR (image_url IS NULL AND ? IS NULL))`)
      .get(description, new Date().toISOString(), reviewerId, reportId, evidence.image_url, evidence.image_url);
    if (!data) throw new Error("Report or evidence changed. Reload before approving.");
    const locationId = z.uuid().parse(data.location_id);
    await recomputeLocationScore(locationId, db);
    const location = z.object({ latitude: z.number(), longitude: z.number() }).nullable()
      .parse(await db.prepare("SELECT lat AS latitude,lng AS longitude FROM locations WHERE id=?").get(locationId));
    if (location) await invalidateNearbyAreaSummaries(location, db);
    return data;
  });
}

/** Rejects and soft-removes a report that shouldn't be public. */
export async function rejectReport(reportId: string) {
  return writeTransaction(async (db) => {
    const data = await db.prepare(`UPDATE reports SET moderation_status='rejected',is_removed=1
      OUTPUT inserted.id,inserted.location_id
      WHERE id=? AND moderation_status='pending' AND is_removed=0`).get(reportId);
    if (!data) throw new Error("Only an existing pending report can be rejected.");
    await recomputeLocationScore(z.uuid().parse(data.location_id), db);
    return data;
  });
}

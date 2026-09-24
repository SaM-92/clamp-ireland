import "server-only";
import { z } from "zod";
import { database, writeTransaction } from "@/lib/db/server";
import {
  deleteReportImage, downloadReportImage, getSignedImageUrl, uploadReportImage,
} from "@/modules/reports/server/imageStorage";
import { recomputeLocationScore } from "@/modules/scoring";
import { invalidateNearbyAreaSummaries } from "@/modules/area-summaries/server/repository";
import { redactImage } from "./redact";
import {
  pendingReportsSchema, type PendingReport, publishedReportsSchema, type PublishedReport, type RedactionRegion,
} from "../types";

/** One admin-supplied edit for a single photo (by its sort_order, 0-2):
 * either a set of drawn redaction rectangles, or a full replacement the admin
 * uploaded themselves (which takes priority over redactions for that photo). */
export interface PhotoEdit {
  redactions?: RedactionRegion[];
  replacementPhoto?: Uint8Array;
}

/** Text and photos awaiting human review. */
export async function listPendingReports(): Promise<PendingReport[]> {
  const db = await database();
  const data = await db.prepare(`SELECT id,location_id,reporter_type,description,has_image,created_at,is_anonymous,is_flagged
    FROM reports WHERE moderation_status='pending' AND is_removed=0 ORDER BY created_at,id`).all();
  const photoRows = await db.prepare(`SELECT rp.report_id,rp.sort_order,rp.image_url FROM report_photos rp
    INNER JOIN reports r ON r.id=rp.report_id
    WHERE r.moderation_status='pending' AND r.is_removed=0 ORDER BY rp.report_id,rp.sort_order`).all();
  const photosByReport = new Map<string, string[]>();
  for (const row of photoRows ?? []) {
    const list = photosByReport.get(row.report_id as string) ?? [];
    list.push(row.image_url as string);
    photosByReport.set(row.report_id as string, list);
  }

  const reports = await Promise.all(
    (data ?? []).map(async (row) => {
      const hasImage = Boolean(row.has_image);
      const rawPhotos = photosByReport.get(row.id as string) ?? [];
      const photos = await Promise.all(rawPhotos.map(async (path) => {
        try {
          return { imageUrl: await getSignedImageUrl(path, 600), imageError: null };
        } catch (error) {
          console.error("[Moderation] private image unavailable", row.id, error);
          return { imageUrl: null, imageError: "Private photo could not be signed or found. Approval is blocked. Reload the queue to retry, or reject the report." };
        }
      }));
      if (hasImage && photos.length === 0) {
        photos.push({ imageUrl: null, imageError: "Report has photo evidence but no storage path. Approval is blocked. Reload the queue to retry, or reject the report." });
      }
      return {
        id: row.id,
        locationId: row.location_id,
        reporterType: row.reporter_type,
        description: row.description ?? "",
        createdAt: row.created_at,
        hasImage, photos,
        isAnonymous: row.is_anonymous === 1 || row.is_anonymous === true,
        isFlagged: row.is_flagged === 1 || row.is_flagged === true,
      };
    })
  );
  return pendingReportsSchema.parse(reports);
}

/** Publish the reviewed wording without changing any private original, unless a photo's edit
 * gives redactions or a replacement - in which case that photo's published copy changes (a
 * replacement takes priority over redactions for the same photo, since the admin has already
 * edited it themselves) and its untouched original is kept privately for audit.
 * `photoEdits[i]` applies to the photo at sort_order i; a missing/undefined entry publishes
 * that photo unchanged. reports.image_url/original_image_url stay mirrored to sort_order 0 only,
 * for every reader that still only knows about a single photo. */
export async function approveReport(
  reportId: string, description: string, reviewerId: string, photoEdits?: (PhotoEdit | undefined)[]
) {
  const db0 = await database();
  const evidence = await db0.prepare(`SELECT user_id,has_image,image_url FROM reports
    WHERE id=? AND moderation_status='pending' AND is_removed=0`).get(reportId);
  if (!evidence) throw new Error("Only an existing pending report can be approved.");
  const photos = await db0.prepare(`SELECT sort_order,image_url FROM report_photos WHERE report_id=? ORDER BY sort_order`).all(reportId);
  if (evidence.has_image || evidence.image_url) {
    if (!evidence.image_url || photos.length === 0) throw new Error("Cannot approve a report with missing photo evidence.");
    for (const photo of photos) await getSignedImageUrl(photo.image_url as string, 600);
  }

  const updates: { sortOrder: number; publishedUrl: string; originalUrl: string | null }[] = [];
  try {
    for (const photo of photos) {
      const sortOrder = photo.sort_order as number;
      const originalPath = photo.image_url as string;
      const edit = photoEdits?.[sortOrder];
      let publishedUrl = originalPath;
      let originalUrl: string | null = null;
      if (edit?.replacementPhoto) {
        publishedUrl = await uploadReportImage(edit.replacementPhoto, evidence.user_id as string);
        originalUrl = originalPath;
      } else if (edit?.redactions && edit.redactions.length > 0) {
        const original = await downloadReportImage(originalPath);
        const redacted = await redactImage(original, edit.redactions);
        publishedUrl = await uploadReportImage(redacted, evidence.user_id as string);
        originalUrl = originalPath;
      }
      updates.push({ sortOrder, publishedUrl, originalUrl });
    }
  } catch (error) {
    // Clean up any uploads already made this pass; the original private evidence is untouched.
    for (const update of updates) if (update.originalUrl) await deleteReportImage(update.publishedUrl).catch(() => {});
    throw error;
  }
  const primary = updates.find((update) => update.sortOrder === 0) ?? null;

  try {
    return await writeTransaction(async (db) => {
      if (!(await db.prepare("SELECT id FROM profiles WHERE id=? AND is_admin=1 AND is_banned=0").get(reviewerId))) {
        throw new Error("An active human administrator is required.");
      }
      const data = await db.prepare(`UPDATE reports SET moderation_status='published',description=?,reviewed_at=?,reviewed_by=?,
          image_url=?,original_image_url=?
        OUTPUT inserted.id,inserted.location_id
        WHERE id=? AND moderation_status='pending' AND is_removed=0 AND (image_url = ? OR (image_url IS NULL AND ? IS NULL))`)
        .get(description, new Date().toISOString(), reviewerId,
          primary ? primary.publishedUrl : evidence.image_url, primary ? primary.originalUrl : null,
          reportId, evidence.image_url, evidence.image_url);
      if (!data) throw new Error("Report or evidence changed. Reload before approving.");
      // Safe unconditionally: report_photos rows are only ever written here, and the guarded
      // UPDATE above already confirmed we are the one and only transition out of "pending".
      for (const update of updates) {
        await db.prepare(`UPDATE report_photos SET image_url=?,original_image_url=? WHERE report_id=? AND sort_order=?`)
          .run(update.publishedUrl, update.originalUrl, reportId, update.sortOrder);
      }
      const locationId = z.uuid().parse(data.location_id);
      await recomputeLocationScore(locationId, db);
      const location = z.object({ latitude: z.number(), longitude: z.number() }).nullable()
        .parse(await db.prepare("SELECT lat AS latitude,lng AS longitude FROM locations WHERE id=?").get(locationId));
      if (location) await invalidateNearbyAreaSummaries(location, db);
      return data;
    });
  } catch (error) {
    // Clean up every fresh upload if the report changed underneath us - the original private
    // evidence is untouched either way.
    for (const update of updates) if (update.originalUrl) await deleteReportImage(update.publishedUrl).catch(() => {});
    throw error;
  }
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

/** Live, published notes an admin can still take down after the fact. */
export async function listPublishedReports(): Promise<PublishedReport[]> {
  const db = await database();
  const data = await db.prepare(`SELECT TOP (200) id,location_id,reporter_type,description,has_image,created_at,reviewed_at,is_anonymous,
      CASE WHEN reviewed_by IS NULL THEN 1 ELSE 0 END AS auto_published
    FROM reports WHERE moderation_status='published' AND is_removed=0 ORDER BY reviewed_at DESC,id DESC`).all();
  return publishedReportsSchema.parse((data ?? []).map((row) => ({
    id: row.id, locationId: row.location_id, reporterType: row.reporter_type,
    description: row.description ?? "", hasImage: Boolean(row.has_image), createdAt: row.created_at, reviewedAt: row.reviewed_at,
    isAnonymous: row.is_anonymous === 1 || row.is_anonymous === true,
    autoPublished: row.auto_published === 1 || row.auto_published === true,
  })));
}

/** Soft-removes a report that is already live - same visibility rules as a moderator rejection,
 * just reachable from a published state instead of pending. The row (and its private original
 * text/photo) stays in the database for audit; it only disappears from dbo.reports_public. */
export async function removePublishedReport(reportId: string, adminId: string) {
  return writeTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM profiles WHERE id=? AND is_admin=1 AND is_banned=0").get(adminId))) {
      throw new Error("An active human administrator is required.");
    }
    const data = await db.prepare(`UPDATE reports SET is_removed=1
      OUTPUT inserted.id,inserted.location_id
      WHERE id=? AND moderation_status='published' AND is_removed=0`).get(reportId);
    if (!data) throw new Error("Only an existing published report can be removed.");
    const locationId = z.uuid().parse(data.location_id);
    await recomputeLocationScore(locationId, db);
    const location = z.object({ latitude: z.number(), longitude: z.number() }).nullable()
      .parse(await db.prepare("SELECT lat AS latitude,lng AS longitude FROM locations WHERE id=?").get(locationId));
    if (location) await invalidateNearbyAreaSummaries(location, db);
    return data;
  });
}

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { database, writeTransaction } from "@/lib/db/server";
import { boundingBox, distanceMetres } from "../../../../database/sql-store.mjs";
import type { SqlConnection } from "../../../../database/sql-store.d.mts";
import { z } from "zod";
import {
  publicAreaSummarySchema, sourceFingerprintSchema, sourceSnapshotSchema, summarySourceSchema,
  summaryOutputSchema, summarySpotSchema, summaryDraftSchema,
  AREA_SUMMARY_MODEL, AREA_SUMMARY_CONTRACT_VERSION,
  type PublicAreaSummary, type SummarySpot,
} from "../types";
import { AreaSummaryError } from "./errors";

/** No SQL geodesic function exists in Azure SQL: a coarse SQL bounding box
 * (well beyond the 500m radius) narrows candidates, then the exact WGS84
 * distance (same geographiclib-geodesic math as before) filters and the
 * count/byte/min/max aggregates are computed in JS over the full filtered
 * set - matching the previous `OVER()` window semantics - before slicing to
 * sources (only ever populated when the set is not oversized, so it never
 * needs to be capped below the true count). */
async function snapshot(spot: SummarySpot, db: SqlConnection) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const box = boundingBox(latitude, longitude, 600);
  const rows = z.array(z.object({
    report_id: z.uuid(), location_id: z.uuid(), description: z.string().nullable(), created_at: z.string(),
    reviewed_at: z.string(), latitude: z.number(), longitude: z.number(),
  })).parse(await db.prepare(`SELECT r.id AS report_id,r.location_id,r.description,r.created_at,r.reviewed_at,
    l.lat AS latitude,l.lng AS longitude
    FROM reports r JOIN locations l ON l.id=r.location_id
    WHERE r.moderation_status='published' AND r.reviewed_at IS NOT NULL AND r.is_removed=0
      AND l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?`)
    .all(box.minLat, box.maxLat, box.minLng, box.maxLng));
  const nearby = rows
    .filter((row) => distanceMetres(row.latitude, row.longitude, latitude, longitude) <= 500.000001)
    .sort((a, b) => (a.report_id < b.report_id ? -1 : a.report_id > b.report_id ? 1 : 0));
  const count = nearby.length;
  const bytes = nearby.reduce((sum, row) => sum + Buffer.byteLength(row.description ?? "", "utf8"), 0);
  const oversized = count > 200 || bytes > 48_000;
  const sources = oversized ? [] : nearby.map((row) => summarySourceSchema.parse({
    report_id: row.report_id, location_id: row.location_id, description: row.description,
    created_at: row.created_at, reviewed_at: row.reviewed_at, latitude: row.latitude, longitude: row.longitude,
  }));
  const oldest = nearby.reduce<string | null>((min, row) => (min === null || row.created_at < min ? row.created_at : min), null);
  const newestCreated = nearby.reduce<string | null>((max, row) => (max === null || row.created_at > max ? row.created_at : max), null);
  const newestReviewed = nearby.reduce<string | null>((max, row) => (max === null || row.reviewed_at > max ? row.reviewed_at : max), null);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    latitude, longitude, radius_metres: 500, count, bytes, oversized, sources,
  })).digest("hex");
  return {
    latitude, longitude, radius_metres: 500, source_fingerprint: fingerprint, source_count: count, source_bytes: bytes,
    oldest_source_created_at: oldest, newest_source_created_at: newestCreated,
    newest_source_reviewed_at: newestReviewed, sources,
  };
}

async function completeSnapshot(spot: SummarySpot, db: SqlConnection) {
  const state = await snapshot(spot, db);
  if (state.source_count > 200 || state.source_bytes > 48_000) throw new Error("Summary resource limit exceeded.");
  if (!state.source_count) throw new Error("No human-approved reports.");
  if (!state.sources.some((source) => source.description?.trim())) throw new Error("No approved note text.");
  return sourceSnapshotSchema.parse(state);
}

export async function getAreaSummarySources(spot: SummarySpot) {
  return completeSnapshot(spot, await database());
}

export async function saveAreaSummaryDraft(spot: SummarySpot, fingerprint: string, output: unknown, regenerate = false) {
  const { sentence } = summaryOutputSchema.parse(output);
  sourceFingerprintSchema.parse(fingerprint);
  return writeTransaction(async (db) => {
    const state = await completeSnapshot(spot, db);
    if (state.source_fingerprint !== fingerprint) throw new Error("Summary sources changed.");
    if (!regenerate) {
      const cached = await db.prepare(`SELECT TOP (1) id FROM area_summaries WHERE latitude=? AND longitude=? AND source_fingerprint=?
        AND model=? AND contract_version=? AND status IN ('draft','approved') ORDER BY generated_at DESC,id DESC`)
        .get(state.latitude, state.longitude, fingerprint, AREA_SUMMARY_MODEL, AREA_SUMMARY_CONTRACT_VERSION);
      if (cached) return z.uuid().parse(cached.id);
    }
    const id = randomUUID();
    await db.prepare(`INSERT INTO area_summaries(id,latitude,longitude,source_fingerprint,source_count,source_bytes,
      oldest_source_created_at,newest_source_created_at,newest_source_reviewed_at,sentence,generated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, state.latitude, state.longitude, fingerprint, state.source_count, state.source_bytes,
      state.oldest_source_created_at, state.newest_source_created_at, state.newest_source_reviewed_at, sentence,
      new Date().toISOString());
    return id;
  });
}

/** Replaces the five SQLite staleness triggers (no T-SQL equivalent can run
 * geodesic distance math). Any write that can change what a nearby summary's
 * sources look like - publishing/removing/editing a report, or moving/deleting
 * a location - must call this in the same transaction, passing the affected
 * report's/location's own coordinates. Marks every draft/approved summary
 * within 500m as permanently 'stale', even if the net effect on a later
 * fingerprint recomputation would be a no-op (e.g. a reverted edit): once the
 * underlying sources have been touched, an already-reviewed summary can never
 * silently keep serving without a fresh human review. */
export async function invalidateNearbyAreaSummaries(spot: SummarySpot, db: SqlConnection) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const box = boundingBox(latitude, longitude, 600);
  const candidates = z.array(z.object({ id: z.uuid(), latitude: z.number(), longitude: z.number() })).parse(
    await db.prepare(`SELECT id,latitude,longitude FROM area_summaries WHERE status IN ('draft','approved')
      AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`)
      .all(box.minLat, box.maxLat, box.minLng, box.maxLng));
  for (const candidate of candidates) {
    if (distanceMetres(candidate.latitude, candidate.longitude, latitude, longitude) <= 500.000001) {
      await db.prepare("UPDATE area_summaries SET status='stale' WHERE id=?").run(candidate.id);
    }
  }
}

export async function getSummaryLocation(id: string): Promise<SummarySpot> {
  const db = await database();
  const row = await db.prepare("SELECT lat AS latitude,lng AS longitude FROM locations WHERE id=? AND report_count>0").get(z.uuid().parse(id));
  if (!row) throw new AreaSummaryError("location_missing", "This location no longer exists.", 404);
  return summarySpotSchema.parse(row);
}

export async function getAreaSummarySourceState(spot: SummarySpot) {
  const state = await snapshot(spot, await database());
  return { source_fingerprint: state.source_fingerprint, source_count: state.source_count, source_bytes: state.source_bytes };
}

export async function getCachedAreaSummaryDraft(spot: SummarySpot, fingerprint: string) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const db = await database();
  return summaryDraftSchema.nullable().parse((await db.prepare(`SELECT TOP (1) id,sentence,source_fingerprint,generated_at
    FROM area_summaries WHERE latitude=? AND longitude=? AND source_fingerprint=? AND model=? AND contract_version=?
    AND status='draft' ORDER BY generated_at DESC,id DESC`)
    .get(latitude, longitude, sourceFingerprintSchema.parse(fingerprint), AREA_SUMMARY_MODEL, AREA_SUMMARY_CONTRACT_VERSION)) ?? null);
}

async function review(db: SqlConnection, id: string, reviewerId: string, decision: "approved" | "rejected", edit?: { sentence: string; fingerprint: string }) {
  if (!(await db.prepare("SELECT id FROM profiles WHERE id=? AND is_admin=1 AND is_banned=0").get(z.uuid().parse(reviewerId)))) {
    throw new Error("An active human administrator is required.");
  }
  const row = await db.prepare("SELECT latitude,longitude,source_fingerprint FROM area_summaries WHERE id=? AND status='draft'").get(z.uuid().parse(id));
  if (!row) throw new Error("Only an existing draft can be reviewed.");
  if (decision === "approved") {
    const state = await completeSnapshot(summarySpotSchema.parse({ latitude: row.latitude, longitude: row.longitude }), db);
    if (state.source_fingerprint !== row.source_fingerprint || (edit && edit.fingerprint !== state.source_fingerprint)) {
      throw new Error("Summary sources changed.");
    }
  }
  if (edit) await db.prepare("UPDATE area_summaries SET sentence=? WHERE id=?").run(edit.sentence, id);
  await db.prepare("UPDATE area_summaries SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?")
    .run(decision, new Date().toISOString(), reviewerId, id);
}

export async function approveAreaSummaryDraft(id: string, reviewerId: string, sentence: string, fingerprint: string) {
  const output = summaryOutputSchema.parse({ sentence });
  const approvedFingerprint = sourceFingerprintSchema.parse(fingerprint);
  await writeTransaction((db) => review(db, id, reviewerId, "approved", { sentence: output.sentence, fingerprint: approvedFingerprint }));
}

export async function acquireAreaSummaryGeneration(spot: SummarySpot) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  return writeTransaction(async (db) => {
    const now = Date.now();
    const lease = randomUUID();
    const result = await db.prepare(`MERGE INTO area_summary_generation_leases WITH (HOLDLOCK) AS target
      USING (SELECT ? AS latitude,? AS longitude) AS source
      ON target.latitude=source.latitude AND target.longitude=source.longitude
      WHEN MATCHED AND target.expires_at<=? THEN UPDATE SET lease_id=?,requested_at=?,expires_at=?
      WHEN NOT MATCHED THEN INSERT (latitude,longitude,lease_id,requested_at,expires_at)
        VALUES (source.latitude,source.longitude,?,?,?);`)
      .run(latitude, longitude, now, lease, now, now + 90_000, lease, now, now + 90_000);
    if (result.changes !== 1) throw new AreaSummaryError("generation_busy", "Generation is already running or cooling down for this spot. Wait up to 90 seconds before another paid request.", 429);
    return lease;
  });
}

export async function releaseAreaSummaryGeneration(leaseId: string) {
  const db = await database();
  const now = Date.now();
  await db.prepare("UPDATE area_summary_generation_leases SET expires_at=IIF(requested_at+60000>?,requested_at+60000,?) WHERE lease_id=?")
    .run(now, now, z.uuid().parse(leaseId));
}

export async function reviewAreaSummary(id: string, reviewerId: string, decision: "approved" | "rejected") {
  z.enum(["approved", "rejected"]).parse(decision);
  await writeTransaction((db) => review(db, id, reviewerId, decision));
}

/** Always recheck current sources; expose no source text, private identifiers or fingerprint. */
export async function getPublicAreaSummary(spot: SummarySpot): Promise<PublicAreaSummary | null> {
  const db = await database();
  const state = await snapshot(spot, db);
  if (!state.source_count || state.source_count > 200 || state.source_bytes > 48_000) return null;
  return publicAreaSummarySchema.nullable().parse((await db.prepare(`SELECT TOP (1) id,latitude,longitude,radius_metres,
    sentence,source_count,oldest_source_created_at,newest_source_created_at,newest_source_reviewed_at,generated_at,
    reviewed_at AS approved_at,model,contract_version FROM area_summaries
    WHERE latitude=? AND longitude=? AND source_fingerprint=? AND source_count=? AND status='approved'
    AND model=? AND contract_version=? ORDER BY reviewed_at DESC,generated_at DESC,id DESC`)
    .get(state.latitude, state.longitude, state.source_fingerprint, state.source_count, AREA_SUMMARY_MODEL, AREA_SUMMARY_CONTRACT_VERSION)) ?? null);
}

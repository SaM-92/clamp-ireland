import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { database, writeTransaction } from "@/lib/db/server";
import { z } from "zod";
import {
  publicAreaSummarySchema, sourceFingerprintSchema, sourceSnapshotSchema, summarySourceSchema,
  summaryOutputSchema, summarySpotSchema, summaryDraftSchema,
  AREA_SUMMARY_MODEL, AREA_SUMMARY_CONTRACT_VERSION,
  type PublicAreaSummary, type SummarySpot,
} from "../types";
import { AreaSummaryError } from "./errors";

function snapshot(spot: SummarySpot, db: DatabaseSync) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  // Window totals cover the whole neighbourhood even when it exceeds the bounded result set.
  const rows = db.prepare(`SELECT r.id AS report_id,r.location_id,r.description,r.created_at,r.reviewed_at,
    l.lat AS latitude,l.lng AS longitude,count(*) OVER() AS source_count,
    sum(length(CAST(r.description AS BLOB))) OVER() AS source_bytes,
    min(r.created_at) OVER() AS oldest_source_created_at,max(r.created_at) OVER() AS newest_source_created_at,
    max(r.reviewed_at) OVER() AS newest_source_reviewed_at
    FROM reports r JOIN locations l ON l.id=r.location_id
    WHERE r.moderation_status='published' AND r.reviewed_at IS NOT NULL AND r.is_removed=0
      AND distance_m(l.lat,l.lng,?,?)<=500.000001 ORDER BY r.id LIMIT 201`).all(latitude, longitude);
  const first = rows[0];
  const count = first ? z.number().int().positive().parse(first.source_count) : 0;
  const bytes = first ? z.number().int().nonnegative().parse(first.source_bytes) : 0;
  const oversized = count > 200 || bytes > 48_000;
  const sources = oversized ? [] : rows.map((row) => summarySourceSchema.parse({
    report_id: row.report_id, location_id: row.location_id, description: row.description,
    created_at: row.created_at, reviewed_at: row.reviewed_at, latitude: row.latitude, longitude: row.longitude,
  }));
  const fingerprint = createHash("sha256").update(JSON.stringify({
    latitude, longitude, radius_metres: 500, count, bytes, oversized, sources,
  })).digest("hex");
  return {
    latitude, longitude, radius_metres: 500, source_fingerprint: fingerprint, source_count: count, source_bytes: bytes,
    oldest_source_created_at: first?.oldest_source_created_at ?? null,
    newest_source_created_at: first?.newest_source_created_at ?? null,
    newest_source_reviewed_at: first?.newest_source_reviewed_at ?? null, sources,
  };
}

function completeSnapshot(spot: SummarySpot, db: DatabaseSync) {
  const state = snapshot(spot, db);
  if (state.source_count > 200 || state.source_bytes > 48_000) throw new Error("Summary resource limit exceeded.");
  if (!state.source_count) throw new Error("No human-approved reports.");
  if (!state.sources.some((source) => source.description?.trim())) throw new Error("No approved note text.");
  return sourceSnapshotSchema.parse(state);
}

export async function getAreaSummarySources(spot: SummarySpot) {
  return completeSnapshot(spot, database());
}

export async function saveAreaSummaryDraft(spot: SummarySpot, fingerprint: string, output: unknown, regenerate = false) {
  const { sentence } = summaryOutputSchema.parse(output);
  sourceFingerprintSchema.parse(fingerprint);
  return writeTransaction((db) => {
    const state = completeSnapshot(spot, db);
    if (state.source_fingerprint !== fingerprint) throw new Error("Summary sources changed.");
    if (!regenerate) {
      const cached = db.prepare(`SELECT id FROM area_summaries WHERE latitude=? AND longitude=? AND source_fingerprint=?
        AND model=? AND contract_version=? AND status IN ('draft','approved') ORDER BY generated_at DESC,id DESC LIMIT 1`)
        .get(state.latitude, state.longitude, fingerprint, AREA_SUMMARY_MODEL, AREA_SUMMARY_CONTRACT_VERSION);
      if (cached) return z.uuid().parse(cached.id);
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO area_summaries(id,latitude,longitude,source_fingerprint,source_count,source_bytes,
      oldest_source_created_at,newest_source_created_at,newest_source_reviewed_at,sentence)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, state.latitude, state.longitude, fingerprint, state.source_count, state.source_bytes,
      state.oldest_source_created_at, state.newest_source_created_at, state.newest_source_reviewed_at, sentence);
    return id;
  });
}

export async function getSummaryLocation(id: string): Promise<SummarySpot> {
  const row = database().prepare("SELECT lat AS latitude,lng AS longitude FROM locations WHERE id=? AND report_count>0").get(z.uuid().parse(id));
  if (!row) throw new AreaSummaryError("location_missing", "This location no longer exists.", 404);
  return summarySpotSchema.parse(row);
}

export async function getAreaSummarySourceState(spot: SummarySpot) {
  const state = snapshot(spot, database());
  return { source_fingerprint: state.source_fingerprint, source_count: state.source_count, source_bytes: state.source_bytes };
}

export async function getCachedAreaSummaryDraft(spot: SummarySpot, fingerprint: string) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  return summaryDraftSchema.nullable().parse(database().prepare(`SELECT id,sentence,source_fingerprint,generated_at
    FROM area_summaries WHERE latitude=? AND longitude=? AND source_fingerprint=? AND model=? AND contract_version=?
    AND status='draft' ORDER BY generated_at DESC,id DESC LIMIT 1`)
    .get(latitude, longitude, sourceFingerprintSchema.parse(fingerprint), AREA_SUMMARY_MODEL, AREA_SUMMARY_CONTRACT_VERSION) ?? null);
}

function review(db: DatabaseSync, id: string, reviewerId: string, decision: "approved" | "rejected", edit?: { sentence: string; fingerprint: string }) {
  if (!db.prepare("SELECT id FROM profiles WHERE id=? AND is_admin=1 AND is_banned=0").get(z.uuid().parse(reviewerId))) {
    throw new Error("An active human administrator is required.");
  }
  const row = db.prepare("SELECT latitude,longitude,source_fingerprint FROM area_summaries WHERE id=? AND status='draft'").get(z.uuid().parse(id));
  if (!row) throw new Error("Only an existing draft can be reviewed.");
  if (decision === "approved") {
    const state = completeSnapshot(summarySpotSchema.parse({ latitude: row.latitude, longitude: row.longitude }), db);
    if (state.source_fingerprint !== row.source_fingerprint || (edit && edit.fingerprint !== state.source_fingerprint)) {
      throw new Error("Summary sources changed.");
    }
  }
  if (edit) db.prepare("UPDATE area_summaries SET sentence=? WHERE id=?").run(edit.sentence, id);
  db.prepare("UPDATE area_summaries SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?")
    .run(decision, new Date().toISOString(), reviewerId, id);
}

export async function approveAreaSummaryDraft(id: string, reviewerId: string, sentence: string, fingerprint: string) {
  const output = summaryOutputSchema.parse({ sentence });
  const approvedFingerprint = sourceFingerprintSchema.parse(fingerprint);
  writeTransaction((db) => review(db, id, reviewerId, "approved", { sentence: output.sentence, fingerprint: approvedFingerprint }));
}

export async function acquireAreaSummaryGeneration(spot: SummarySpot) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  return writeTransaction((db) => {
    const now = Date.now();
    const lease = randomUUID();
    const result = db.prepare(`INSERT INTO area_summary_generation_leases(latitude,longitude,lease_id,requested_at,expires_at)
      VALUES (?,?,?,?,?) ON CONFLICT(latitude,longitude) DO UPDATE SET
      lease_id=excluded.lease_id,requested_at=excluded.requested_at,expires_at=excluded.expires_at
      WHERE expires_at<=?`).run(latitude, longitude, lease, now, now + 90_000, now);
    if (result.changes !== 1) throw new AreaSummaryError("generation_busy", "Generation is already running or cooling down for this spot. Wait up to 90 seconds before another paid request.", 429);
    return lease;
  });
}

export async function releaseAreaSummaryGeneration(leaseId: string) {
  database().prepare("UPDATE area_summary_generation_leases SET expires_at=max(requested_at+60000,?) WHERE lease_id=?")
    .run(Date.now(), z.uuid().parse(leaseId));
}

export async function reviewAreaSummary(id: string, reviewerId: string, decision: "approved" | "rejected") {
  z.enum(["approved", "rejected"]).parse(decision);
  writeTransaction((db) => review(db, id, reviewerId, decision));
}

/** Always recheck current sources; expose no source text, private identifiers or fingerprint. */
export async function getPublicAreaSummary(spot: SummarySpot): Promise<PublicAreaSummary | null> {
  const state = snapshot(spot, database());
  if (!state.source_count || state.source_count > 200 || state.source_bytes > 48_000) return null;
  return publicAreaSummarySchema.nullable().parse(database().prepare(`SELECT id,latitude,longitude,radius_metres,
    sentence,source_count,oldest_source_created_at,newest_source_created_at,newest_source_reviewed_at,generated_at,
    reviewed_at AS approved_at,model,contract_version FROM area_summaries
    WHERE latitude=? AND longitude=? AND source_fingerprint=? AND source_count=? AND status='approved'
    AND model=? AND contract_version=? ORDER BY reviewed_at DESC,generated_at DESC,id DESC LIMIT 1`)
    .get(state.latitude, state.longitude, state.source_fingerprint, state.source_count, AREA_SUMMARY_MODEL, AREA_SUMMARY_CONTRACT_VERSION) ?? null);
}

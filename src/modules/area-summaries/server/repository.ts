import "server-only";
import { createAnonServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { z } from "zod";
import {
  publicAreaSummarySchema,
  sourceFingerprintSchema,
  sourceSnapshotSchema,
  summaryOutputSchema,
  summarySpotSchema,
  summaryDraftSchema,
  AREA_SUMMARY_MODEL,
  AREA_SUMMARY_CONTRACT_VERSION,
  type PublicAreaSummary,
  type SummarySpot,
} from "../types";
import { AreaSummaryError } from "./errors";

export async function getAreaSummarySources(spot: SummarySpot) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const { data, error } = await createServiceRoleClient().rpc("get_area_summary_sources", {
    p_lat: latitude, p_lng: longitude,
  });
  if (error) throw error;
  return sourceSnapshotSchema.parse(data);
}

// The database rechecks the fingerprint before saving. Never accept a source
// snapshot or reviewer identity directly from an unauthenticated HTTP request.
export async function saveAreaSummaryDraft(spot: SummarySpot, fingerprint: string, output: unknown, regenerate = false) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const { sentence } = summaryOutputSchema.parse(output);
  const { data, error } = await createServiceRoleClient().rpc("create_area_summary_draft", {
    p_lat: latitude, p_lng: longitude,
    p_source_fingerprint: sourceFingerprintSchema.parse(fingerprint), p_sentence: sentence,
    ...(regenerate ? { p_regenerate: true } : {}),
  });
  if (error) throw error;
  return z.uuid().parse(data);
}

export async function getSummaryLocation(id: string): Promise<SummarySpot> {
  const { data, error } = await createAnonServerClient().from("locations_public")
    .select("lat, lng").eq("id", z.uuid().parse(id)).maybeSingle();
  if (error) throw error;
  if (!data) throw new AreaSummaryError("location_missing", "This location no longer exists.", 404);
  return summarySpotSchema.parse({ latitude: data.lat, longitude: data.lng });
}

export async function getAreaSummarySourceState(spot: SummarySpot) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const { data, error } = await createServiceRoleClient().rpc("area_summary_source_state", {
    p_lat: latitude, p_lng: longitude,
  });
  if (error) throw error;
  return z.array(z.object({
    source_fingerprint: sourceFingerprintSchema,
    source_count: z.number().int().nonnegative(),
    source_bytes: z.number().int().nonnegative(),
  })).length(1).parse(data)[0];
}

export async function getCachedAreaSummaryDraft(spot: SummarySpot, fingerprint: string) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const { data, error } = await createServiceRoleClient().from("area_summaries")
    .select("id, sentence, source_fingerprint, generated_at")
    .eq("latitude", latitude).eq("longitude", longitude)
    .eq("source_fingerprint", sourceFingerprintSchema.parse(fingerprint))
    .eq("model", AREA_SUMMARY_MODEL).eq("contract_version", AREA_SUMMARY_CONTRACT_VERSION)
    .eq("status", "draft").order("generated_at", { ascending: false })
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return summaryDraftSchema.nullable().parse(data);
}

export async function approveAreaSummaryDraft(id: string, reviewerId: string, sentence: string, fingerprint: string) {
  const output = summaryOutputSchema.parse({ sentence });
  const { error } = await createServiceRoleClient().rpc("approve_area_summary_draft", {
    p_id: z.uuid().parse(id), p_reviewer: z.uuid().parse(reviewerId),
    p_sentence: output.sentence, p_source_fingerprint: sourceFingerprintSchema.parse(fingerprint),
  });
  if (error) throw error;
}

export async function acquireAreaSummaryGeneration(spot: SummarySpot) {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const { data, error } = await createServiceRoleClient().rpc("acquire_area_summary_generation", {
    p_lat: latitude, p_lng: longitude,
  });
  if (error) throw error;
  const lease = z.uuid().nullable().parse(data);
  if (!lease) throw new AreaSummaryError("generation_busy", "Generation is already running or cooling down for this spot. Wait up to 90 seconds before another paid request.", 429);
  return lease;
}

export async function releaseAreaSummaryGeneration(leaseId: string) {
  const { error } = await createServiceRoleClient().rpc("release_area_summary_generation", {
    p_lease_id: z.uuid().parse(leaseId),
  });
  if (error) throw error;
}

export async function reviewAreaSummary(id: string, reviewerId: string, decision: "approved" | "rejected") {
  const { error } = await createServiceRoleClient().rpc("review_area_summary", {
    p_id: z.uuid().parse(id),
    p_reviewer: z.uuid().parse(reviewerId),
    p_decision: z.enum(["approved", "rejected"]).parse(decision),
  });
  if (error) throw error;
}

// Call on each request, without a Next/CDN/client persistent response cache.
// No service-role fallback: this RPC is the only public summary read surface.
export async function getPublicAreaSummary(spot: SummarySpot): Promise<PublicAreaSummary | null> {
  const { latitude, longitude } = summarySpotSchema.parse(spot);
  const { data, error } = await createAnonServerClient().rpc("get_public_area_summary", {
    p_lat: latitude, p_lng: longitude,
  });
  if (error) throw error;
  return publicAreaSummarySchema.nullable().parse(data);
}

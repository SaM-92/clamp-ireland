import { z } from "zod";

export const AREA_SUMMARY_RADIUS_METRES = 500;
export const AREA_SUMMARY_MODEL = "gpt-5-mini";
export const AREA_SUMMARY_CONTRACT_VERSION = "area-summary-v1";
export const AREA_SUMMARY_MAX_SOURCES = 200;
export const AREA_SUMMARY_MAX_SOURCE_BYTES = 48_000;
export const AREA_SUMMARY_MAX_INPUT_BYTES = 96_000;
export const AREA_SUMMARY_MAX_SENTENCE_LENGTH = 240;

export const summarySpotSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// Deliberately conservative: no abbreviations, decimals or embedded sentences.
// This checks structure, not truthfulness or anonymity; human review is mandatory.
export const summarySentenceSchema = z.string()
  .min(18).max(AREA_SUMMARY_MAX_SENTENCE_LENGTH)
  .regex(/^Reports mention [^.!?\r\n]+\.$/, "Use one short sentence beginning 'Reports mention '.")
  .refine((value) => !/[\u0000-\u001f\u007f<>@]|https?:|www\./i.test(value),
    "Do not include control characters, markup or contact links.");

export const summaryOutputSchema = z.strictObject({
  sentence: summarySentenceSchema,
});

export const sourceFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });

export const summarySourceSchema = z.strictObject({
  report_id: z.uuid(),
  location_id: z.uuid(),
  description: z.string().nullable(),
  created_at: timestampSchema,
  reviewed_at: timestampSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const sourceSnapshotSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_metres: z.literal(AREA_SUMMARY_RADIUS_METRES),
  source_fingerprint: sourceFingerprintSchema,
  source_count: z.number().int().positive().max(AREA_SUMMARY_MAX_SOURCES),
  source_bytes: z.number().int().nonnegative().max(AREA_SUMMARY_MAX_SOURCE_BYTES),
  oldest_source_created_at: timestampSchema,
  newest_source_created_at: timestampSchema,
  newest_source_reviewed_at: timestampSchema,
  sources: z.array(summarySourceSchema).min(1).max(AREA_SUMMARY_MAX_SOURCES),
}).superRefine((snapshot, ctx) => {
  if (snapshot.sources.length !== snapshot.source_count ||
      new Set(snapshot.sources.map((source) => source.report_id)).size !== snapshot.source_count) {
    ctx.addIssue({ code: "custom", message: "The complete, unique source set is required." });
  }
  const bytes = snapshot.sources.reduce(
    (total, source) => total + new TextEncoder().encode(source.description ?? "").length, 0,
  );
  if (bytes !== snapshot.source_bytes) {
    ctx.addIssue({ code: "custom", message: "Source byte count does not match the complete source set." });
  }
  if (!snapshot.sources.some((source) => source.description?.trim())) {
    ctx.addIssue({ code: "custom", message: "There is no approved note text to summarise." });
  }
});

export const publicAreaSummarySchema = z.strictObject({
  id: z.uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_metres: z.literal(AREA_SUMMARY_RADIUS_METRES),
  sentence: summarySentenceSchema,
  source_count: z.number().int().positive().max(AREA_SUMMARY_MAX_SOURCES),
  oldest_source_created_at: timestampSchema,
  newest_source_created_at: timestampSchema,
  newest_source_reviewed_at: timestampSchema,
  generated_at: timestampSchema,
  approved_at: timestampSchema,
  model: z.literal(AREA_SUMMARY_MODEL),
  contract_version: z.literal(AREA_SUMMARY_CONTRACT_VERSION),
});

export type SummarySpot = z.infer<typeof summarySpotSchema>;
export type SummaryOutput = z.infer<typeof summaryOutputSchema>;
export type SummarySourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type PublicAreaSummary = z.infer<typeof publicAreaSummarySchema>;
export type AreaSummaryStatus = "draft" | "approved" | "rejected" | "stale";

export const AREA_SUMMARY_TIMEOUT_MS = 30_000;
export const AREA_SUMMARY_MAX_OUTPUT_TOKENS = 1_024;

export const summarySetupSchema = z.strictObject({
  state: z.enum(["ready", "disabled", "unconfigured"]),
  message: z.string(),
});

export const summaryDisplaySchema = z.strictObject({
  sentence: summarySentenceSchema,
  sourceCount: z.number().int().positive().max(AREA_SUMMARY_MAX_SOURCES),
  radiusMetres: z.literal(500),
  generatedAt: timestampSchema,
  reviewedAt: timestampSchema,
});

export const summaryDraftSchema = z.strictObject({
  id: z.uuid(),
  sentence: summarySentenceSchema,
  source_fingerprint: sourceFingerprintSchema,
  generated_at: timestampSchema,
});

export const summaryWorkspaceSchema = z.strictObject({
  locationId: z.uuid(),
  radiusMetres: z.literal(500),
  sourceCount: z.number().int().nonnegative(),
  sourceBytes: z.number().int().nonnegative(),
  sourceFingerprint: sourceFingerprintSchema,
  blockedReason: z.string().nullable(),
  notes: z.array(z.strictObject({ description: z.string().nullable() })).max(AREA_SUMMARY_MAX_SOURCES),
  draft: summaryDraftSchema.nullable(),
  published: summaryDisplaySchema.nullable(),
});

export const adminSummaryResponseSchema = z.strictObject({
  setup: summarySetupSchema,
  workspace: summaryWorkspaceSchema.nullable(),
});

export const publicSummaryResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), summary: summaryDisplaySchema }),
  z.strictObject({ state: z.enum(["none", "disabled", "unconfigured"]), message: z.string() }),
]);

export type SummarySetup = z.infer<typeof summarySetupSchema>;
export type SummaryWorkspace = z.infer<typeof summaryWorkspaceSchema>;
export type SummaryDisplay = z.infer<typeof summaryDisplaySchema>;
export type PublicSummaryResponse = z.infer<typeof publicSummaryResponseSchema>;

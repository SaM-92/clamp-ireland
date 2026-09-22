import "server-only";
import { AiProviderError, parseStructuredResponse, requestStructuredOutput } from "@/modules/ai/server/client";
import { buildAreaSummaryInput } from "../contract";
import {
  AREA_SUMMARY_MAX_OUTPUT_TOKENS, AREA_SUMMARY_TIMEOUT_MS, summaryOutputSchema,
  type SummaryOutput,
} from "../types";
import { requireAreaSummarySetup } from "./config";
import { AreaSummaryError } from "./errors";

export function parseAreaSummaryResponse(value: unknown): SummaryOutput {
  try {
    return summaryOutputSchema.parse(parseStructuredResponse(value));
  } catch (error) {
    if (error instanceof AiProviderError) throw new AreaSummaryError(error.code, error.message, error.status);
    throw new AreaSummaryError("provider_malformed", "The provider returned malformed summary output. No draft was saved.", 502);
  }
}

export async function generateSummaryFromSnapshot(snapshot: unknown, fetcher: typeof fetch = fetch): Promise<SummaryOutput> {
  let input: ReturnType<typeof buildAreaSummaryInput>;
  try {
    input = buildAreaSummaryInput(snapshot);
  } catch {
    throw new AreaSummaryError("source_limit", "The complete source set is invalid or exceeds the 200-note, 48,000-source-byte or 96,000-input-byte limit. No request was sent.");
  }
  try {
    const output = await requestStructuredOutput({
      instructions: input.instructions, input: input.input, format: input.text.format,
      maxOutputTokens: AREA_SUMMARY_MAX_OUTPUT_TOKENS, timeoutMs: AREA_SUMMARY_TIMEOUT_MS,
    }, fetcher);
    const parsed = summaryOutputSchema.safeParse(output);
    if (!parsed.success) throw new AreaSummaryError("provider_malformed",
      "The generated summary did not meet the one-sentence, 20-word and 160-character rules. No draft was saved.", 502);
    return parsed.data;
  } catch (error) {
    if (error instanceof AiProviderError) throw new AreaSummaryError(error.code, error.message, error.status);
    if (error instanceof AreaSummaryError) throw error;
    throw new AreaSummaryError("provider_failed", "Summary generation failed. No draft was saved.", 502);
  }
}

export async function generateAreaSummaryOutput(snapshot: unknown, fetcher: typeof fetch = fetch): Promise<SummaryOutput> {
  requireAreaSummarySetup();
  return generateSummaryFromSnapshot(snapshot, fetcher);
}

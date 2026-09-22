import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { buildAreaSummaryInput } from "../contract";
import {
  AREA_SUMMARY_MAX_OUTPUT_TOKENS, AREA_SUMMARY_TIMEOUT_MS, summaryOutputSchema,
  type SummaryOutput,
} from "../types";
import { requireAreaSummarySetup } from "./config";
import { AreaSummaryError } from "./errors";
import { readBoundedJson } from "@/lib/server/readBoundedJson";

const responseSchema = z.object({
  status: z.string(),
  error: z.unknown().nullish(),
  output: z.array(z.object({
    type: z.string(),
    role: z.string().optional(),
    status: z.string().optional(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    })).optional(),
  })),
});

export function parseAreaSummaryResponse(value: unknown): SummaryOutput {
  const parsed = responseSchema.safeParse(value);
  const malformed = () => new AreaSummaryError("provider_malformed", "The provider returned malformed summary output. No draft was saved.", 502);
  if (!parsed.success) throw malformed();
  const response = parsed.data;
  if (response.status === "incomplete") {
    throw new AreaSummaryError("provider_incomplete", "The provider did not finish within its output budget. No draft was saved.", 502);
  }
  if (response.status !== "completed" || response.error != null) {
    throw new AreaSummaryError("provider_failed", "The provider did not complete the summary. No draft was saved.", 502);
  }
  const texts: string[] = [];
  for (const item of response.output) {
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !item.content) {
      throw malformed();
    }
    for (const content of item.content) {
      if (content.type === "refusal") {
        throw new AreaSummaryError("provider_refusal", "The provider refused to summarise these notes. No draft was saved; review the sources.", 422);
      }
      if (content.type !== "output_text" || typeof content.text !== "string") throw malformed();
      texts.push(content.text);
    }
  }
  if (texts.length !== 1) throw malformed();
  try {
    return summaryOutputSchema.parse(JSON.parse(texts[0]));
  } catch {
    throw malformed();
  }
}

export async function generateAreaSummaryOutput(snapshot: unknown, fetcher: typeof fetch = fetch): Promise<SummaryOutput> {
  requireAreaSummarySetup();
  let input: ReturnType<typeof buildAreaSummaryInput>;
  try {
    input = buildAreaSummaryInput(snapshot);
  } catch {
    throw new AreaSummaryError("source_limit", "The complete source set is invalid or exceeds the 200-note, 48,000-source-byte or 96,000-input-byte limit. No request was sent.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AREA_SUMMARY_TIMEOUT_MS);
  try {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      body: JSON.stringify({
        model: input.model,
        instructions: input.instructions,
        input: input.input,
        text: input.text,
        reasoning: { effort: "minimal" },
        max_output_tokens: AREA_SUMMARY_MAX_OUTPUT_TOKENS,
        store: false,
        stream: false,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) {
        throw new AreaSummaryError("provider_rate_limit", "OpenAI rate or quota limit reached. No automatic retry was made; check billing or retry later.", 429);
      }
      throw new AreaSummaryError("provider_http", "OpenAI could not process the request. Check the server key and provider availability; no draft was saved.", 502);
    }
    return parseAreaSummaryResponse(await readBoundedJson(response, 65_536,
      new AreaSummaryError("provider_malformed", "OpenAI returned invalid or oversized JSON. No draft was saved.", 502)));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AreaSummaryError("provider_timeout", "Generation timed out after 30 seconds. No automatic retry was made; a provider charge may still apply.", 504);
    }
    if (error instanceof AreaSummaryError) throw error;
    throw new AreaSummaryError("provider_network", "Could not reach OpenAI. No automatic retry was made; check connectivity before trying again.", 502);
  } finally {
    clearTimeout(timer);
  }
}

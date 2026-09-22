import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { readBoundedJson } from "@/lib/server/readBoundedJson";
import { AiProviderError } from "@/modules/ai/server/errors";
import { getAiConfiguration } from "@/modules/ai/server/config";
import { allowLocalDemoRequest, localAiDemoEnabled } from "@/modules/ai-demo/server/guard";
import { remainingDemoRequests, reserveDemoRequest } from "@/modules/ai-demo/server/budget";
import { DEMO_CASES, DEMO_NOTES, type DemoCase, type DemoResult } from "@/modules/ai-demo/samples";
import { generateSummaryFromSnapshot } from "@/modules/area-summaries/server/provider";
import { AreaSummaryError } from "@/modules/area-summaries/server/errors";
import { ContentPolicyError, validateContent } from "@/modules/content-policy/policy";
import { checkContentPolicy } from "@/modules/content-policy/server/check";

export const dynamic = "force-dynamic";
const inputSchema = z.strictObject({ example: z.enum(["summary", "allowed-note", "abusive-note", "unsafe-username"]) });
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const cache = new Map<DemoCase, Omit<DemoResult, "remaining" | "cached">>();
let busy = false;

export function GET() {
  return NextResponse.json({ error: "Not found." }, { status: 404, headers });
}

function snapshot() {
  const timestamp = "2026-09-22T12:00:00Z";
  return {
    latitude: 53.35, longitude: -6.26, radius_metres: 500,
    source_fingerprint: "0".repeat(64), source_count: DEMO_NOTES.length,
    source_bytes: DEMO_NOTES.reduce((sum, text) => sum + new TextEncoder().encode(text).length, 0),
    oldest_source_created_at: timestamp, newest_source_created_at: timestamp, newest_source_reviewed_at: timestamp,
    sources: DEMO_NOTES.map((description, index) => ({
      report_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      location_id: "10000000-0000-4000-8000-000000000099",
      description, created_at: timestamp, reviewed_at: timestamp, latitude: 53.35, longitude: -6.26,
    })),
  };
}

export async function POST(request: Request) {
  if (!localAiDemoEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404, headers });
  if (!allowLocalDemoRequest(request)) return NextResponse.json({ error: "Only the same-origin loopback demo is allowed." }, { status: 403, headers });
  if (busy) return NextResponse.json({ error: "Another demo is running. Wait for its result." }, { status: 409, headers });
  let id: DemoCase;
  try {
    const input = inputSchema.parse(await readBoundedJson(request, 512, new Error("Invalid demo request")));
    id = input.example;
  } catch {
    return NextResponse.json({ error: "Choose one of the fixed synthetic examples. Free text is not accepted." }, { status: 400, headers });
  }
  busy = true;
  let remaining: number | undefined;
  const start = performance.now();
  try {
    if (env.AI_PROVIDER !== "azure") throw new AiProviderError("unconfigured", "This demonstration requires the Azure AI provider.", 503);
    getAiConfiguration();
    remaining = await remainingDemoRequests();
    const cached = cache.get(id);
    if (cached) return NextResponse.json({ ...cached, remaining, cached: true }, { headers });
    const example = DEMO_CASES[id];
    let result: Omit<DemoResult, "remaining" | "cached">;
    if (example.kind === "summary") {
      remaining = await reserveDemoRequest();
      const output = await generateSummaryFromSnapshot(snapshot());
      result = { source: "azure", kind: "summary", message: output.sentence, durationMs: performance.now() - start };
    } else {
      const kind = example.kind === "report" ? "report_note" : "username";
      let usedAi = false;
      try {
        validateContent(kind, example.text);
        remaining = await reserveDemoRequest();
        usedAi = true;
        await checkContentPolicy({ kind, text: example.text });
        result = { source: "azure", kind: "policy", allowed: true,
          message: "Passed automated content checks. This does not approve a report for publication.", durationMs: performance.now() - start };
      } catch (error) {
        if (!(error instanceof ContentPolicyError) || error.code !== "content_policy_rejected") throw error;
        result = { source: usedAi ? "azure" : "local-rule", kind: "policy", allowed: false,
          message: error.message, durationMs: performance.now() - start };
      }
    }
    cache.set(id, result);
    return NextResponse.json({ ...result, remaining, cached: false }, { headers });
  } catch (error) {
    const known = error instanceof AiProviderError || error instanceof AreaSummaryError || error instanceof ContentPolicyError;
    console.error("Local AI demonstration failed", { code: known ? error.code : "demo_budget_unavailable" });
    return NextResponse.json({
      error: known ? error.message : "The local demo budget is unavailable or exhausted. No automatic retry was made.",
      ...(remaining === undefined ? {} : { remaining }),
    }, { status: known ? error.status : 503, headers });
  } finally {
    busy = false;
  }
}

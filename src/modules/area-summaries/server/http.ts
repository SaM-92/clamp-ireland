import "server-only";
import { NextResponse } from "next/server";
import { AreaSummaryError, safeSummaryError } from "./errors";
import { readBoundedJson } from "./json";

export const summaryPrivateHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization" };
export const summaryPublicHeaders = { "Cache-Control": "no-store" };

export function summaryErrorResponse(error: unknown, privateResponse = true) {
  const safe = safeSummaryError(error);
  // Fixed, allowlisted error codes only. No notes, response bodies or keys.
  console.error("[AreaSummaries]", safe.code);
  return NextResponse.json({ error: safe.message, code: safe.code }, {
    status: safe.status, headers: privateResponse ? summaryPrivateHeaders : summaryPublicHeaders,
  });
}

export function readSummaryRequest(request: Request) {
  return readBoundedJson(request, 4096,
    new AreaSummaryError("invalid_request", "A valid JSON request of at most 4,096 bytes is required.", 400));
}

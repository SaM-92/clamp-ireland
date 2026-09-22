import "server-only";

export class AreaSummaryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422) {
    super(message);
    this.name = "AreaSummaryError";
  }
}

export function safeSummaryError(error: unknown): AreaSummaryError {
  if (error instanceof AreaSummaryError) return error;
  // Only known database messages become actionable client errors; never echo
  // provider responses, SQL details, notes, credentials or arbitrary exceptions.
  const message = error && typeof error === "object" && "message" in error
    && typeof error.message === "string" ? error.message : "";
  if (/sources changed|Only an existing draft/.test(message)) {
    return new AreaSummaryError("stale", "Sources or draft changed. Reload the location and review a fresh draft.", 409);
  }
  if (/resource limit exceeded/.test(message)) {
    return new AreaSummaryError("source_limit", "The complete neighbourhood exceeds 200 notes or 48,000 UTF-8 bytes. No subset was summarised.");
  }
  if (/No human-approved|No approved note text/.test(message)) {
    return new AreaSummaryError("no_sources", "There is no human-approved note text to summarise.");
  }
  if (/active human administrator/.test(message)) {
    return new AreaSummaryError("access", "Active administrator access is required.", 403);
  }
  return new AreaSummaryError("unavailable", "Area summaries could not be loaded or saved. Check backend configuration and retry.", 503);
}

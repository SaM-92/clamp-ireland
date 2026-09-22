import "server-only";
import { buildAreaSummaryInput } from "../contract";
import {
  AREA_SUMMARY_MAX_SOURCES, AREA_SUMMARY_MAX_SOURCE_BYTES,
  type PublicAreaSummary, type SummaryDisplay, type SummaryWorkspace,
} from "../types";
import { requireAreaSummarySetup } from "./config";
import { AreaSummaryError, safeSummaryError } from "./errors";
import { generateAreaSummaryOutput } from "./provider";
import {
  acquireAreaSummaryGeneration, getAreaSummarySources, getAreaSummarySourceState,
  getCachedAreaSummaryDraft, getPublicAreaSummary, getSummaryLocation,
  releaseAreaSummaryGeneration, saveAreaSummaryDraft,
} from "./repository";

export function summaryDisplay(summary: PublicAreaSummary | null): SummaryDisplay | null {
  return summary ? {
    sentence: summary.sentence, sourceCount: summary.source_count, radiusMetres: 500,
    generatedAt: summary.generated_at, reviewedAt: summary.approved_at,
  } : null;
}

export async function getAreaSummaryWorkspace(locationId: string): Promise<SummaryWorkspace> {
  requireAreaSummarySetup();
  const spot = await getSummaryLocation(locationId);
  const [state, published] = await Promise.all([
    getAreaSummarySourceState(spot), getPublicAreaSummary(spot),
  ]);
  const workspace: SummaryWorkspace = {
    locationId, radiusMetres: 500, sourceCount: state.source_count, sourceBytes: state.source_bytes,
    sourceFingerprint: state.source_fingerprint, blockedReason: null, notes: [],
    draft: null, published: summaryDisplay(published),
  };
  if (state.source_count === 0) {
    return { ...workspace, blockedReason: "No human-approved published notes in this 500m neighbourhood." };
  }
  if (state.source_count > AREA_SUMMARY_MAX_SOURCES || state.source_bytes > AREA_SUMMARY_MAX_SOURCE_BYTES) {
    return { ...workspace, blockedReason: "This complete neighbourhood exceeds 200 notes or 48,000 UTF-8 bytes. Generation is blocked; no arbitrary subset will be used." };
  }
  let snapshot;
  try {
    snapshot = await getAreaSummarySources(spot);
  } catch (error) {
    const safe = safeSummaryError(error);
    if (safe.code === "no_sources" || safe.code === "source_limit") {
      return { ...workspace, blockedReason: safe.message };
    }
    throw error;
  }
  workspace.sourceCount = snapshot.source_count;
  workspace.sourceBytes = snapshot.source_bytes;
  workspace.sourceFingerprint = snapshot.source_fingerprint;
  workspace.notes = snapshot.sources.map(({ description }) => ({ description }));
  try {
    buildAreaSummaryInput(snapshot);
  } catch {
    return { ...workspace, blockedReason: "The complete serialized input exceeds 96,000 UTF-8 bytes or fails validation. No request will be sent." };
  }
  workspace.draft = await getCachedAreaSummaryDraft(spot, snapshot.source_fingerprint);
  return workspace;
}

export async function generateAreaSummaryDraft(locationId: string, regenerate: boolean) {
  requireAreaSummarySetup();
  const spot = await getSummaryLocation(locationId);
  const snapshot = await getAreaSummarySources(spot);
  try {
    buildAreaSummaryInput(snapshot);
  } catch {
    throw new AreaSummaryError("input_limit", "The complete serialized input exceeds 96,000 UTF-8 bytes or fails validation. No request was sent.");
  }
  if (!regenerate && await getCachedAreaSummaryDraft(spot, snapshot.source_fingerprint)) {
    return getAreaSummaryWorkspace(locationId);
  }
  const lease = await acquireAreaSummaryGeneration(spot);
  try {
    const output = await generateAreaSummaryOutput(snapshot);
    // Always a new draft; never replace an approved row or publish automatically.
    await saveAreaSummaryDraft(spot, snapshot.source_fingerprint, output, true);
  } finally {
    await releaseAreaSummaryGeneration(lease);
  }
  return getAreaSummaryWorkspace(locationId);
}

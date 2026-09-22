import { NextResponse } from "next/server";
import { z } from "zod";
import { getAreaSummarySetup } from "@/modules/area-summaries/server/config";
import { AreaSummaryError } from "@/modules/area-summaries/server/errors";
import { summaryErrorResponse, summaryPublicHeaders } from "@/modules/area-summaries/server/http";
import { getPublicAreaSummary, getSummaryLocation } from "@/modules/area-summaries/server/repository";
import type { PublicSummaryResponse } from "@/modules/area-summaries/types";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new AreaSummaryError("invalid_location", "Invalid location.", 400);
    const setup = getAreaSummarySetup();
    let result: PublicSummaryResponse;
    if (setup.state !== "ready") {
      result = {
        state: setup.state,
        message: setup.state === "disabled" ? "Nearby summaries are disabled." : "Nearby summaries are not configured on this deployment.",
      };
    } else {
      const summary = await getPublicAreaSummary(await getSummaryLocation(id));
      result = summary ? {
        state: "available",
        summary: {
          sentence: summary.sentence, sourceCount: summary.source_count, radiusMetres: 500,
          generatedAt: summary.generated_at, reviewedAt: summary.approved_at,
        },
      } : { state: "none", message: "No current human-approved summary is available for this neighbourhood." };
    }
    return NextResponse.json(result, { headers: summaryPublicHeaders });
  } catch (error) { return summaryErrorResponse(error, false); }
}

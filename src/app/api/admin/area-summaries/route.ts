import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { getAreaSummarySetup, requireAreaSummarySetup } from "@/modules/area-summaries/server/config";
import { AreaSummaryError } from "@/modules/area-summaries/server/errors";
import { readSummaryRequest, summaryErrorResponse, summaryPrivateHeaders } from "@/modules/area-summaries/server/http";
import { generateAreaSummaryDraft, getAreaSummaryWorkspace } from "@/modules/area-summaries/server/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const generateSchema = z.strictObject({ locationId: z.uuid(), regenerate: z.boolean().default(false) });

export async function GET(request: Request) {
  try {
    if (!await requireAdmin(request)) throw new AreaSummaryError("access", "Sign in as an admin to manage area summaries.", 403);
    const setup = getAreaSummarySetup();
    const locationId = new URL(request.url).searchParams.get("locationId");
    if (locationId !== null && !z.uuid().safeParse(locationId).success) {
      throw new AreaSummaryError("invalid_location", "Choose a valid location.", 400);
    }
    const workspace = setup.state === "ready" && locationId ? await getAreaSummaryWorkspace(locationId) : null;
    return NextResponse.json({ setup, workspace }, { headers: summaryPrivateHeaders });
  } catch (error) { return summaryErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (!await requireAdmin(request)) throw new AreaSummaryError("access", "Administrator access is required to generate a draft.", 403);
    requireAreaSummarySetup();
    const parsed = generateSchema.safeParse(await readSummaryRequest(request));
    if (!parsed.success) throw new AreaSummaryError("invalid_request", "Choose a valid location and generation action.", 400);
    const workspace = await generateAreaSummaryDraft(parsed.data.locationId, parsed.data.regenerate);
    return NextResponse.json({ setup: getAreaSummarySetup(), workspace }, { headers: summaryPrivateHeaders });
  } catch (error) { return summaryErrorResponse(error); }
}

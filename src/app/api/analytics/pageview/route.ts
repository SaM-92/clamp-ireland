import { NextResponse } from "next/server";
import { isTrafficEnabled } from "@/modules/analytics/server/config";
import { readTrafficEvent, TrafficRequestError } from "@/modules/analytics/server/request";
import { incrementTraffic } from "@/modules/analytics/server/repository";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isTrafficEnabled()) {
    return NextResponse.json({ enabled: false, reason: "Analytics not enabled" }, { headers });
  }
  try {
    const event = await readTrafficEvent(request);
    await incrementTraffic(event);
    return NextResponse.json({ enabled: true, recorded: true }, { headers });
  } catch (error) {
    if (error instanceof TrafficRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    console.error("[Traffic] aggregate increment failed");
    return NextResponse.json({ error: "Traffic collection unavailable." }, { status: 503, headers });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/modules/auth/server/session";
import { isDatabaseConfigured } from "@/lib/env";
import { findOrCreateLocation, listPublicLocations } from "@/modules/locations/server/repository";

export async function GET() {
  if (!isDatabaseConfigured) return NextResponse.json([]);
  try { return NextResponse.json(await listPublicLocations()); }
  catch {
    console.error("[Locations] public read failed");
    return NextResponse.json({ error: "Could not load reported locations." }, { status: 503 });
  }
}
export async function POST(request: Request) {
  try {
    if (!await getUserFromRequest(request)) return NextResponse.json({ error: "Sign in required to add a location." }, { status: 401 });
    const body = z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: "Supply valid latitude and longitude." }, { status: 400 });
    return NextResponse.json(await findOrCreateLocation(body.data.lat, body.data.lng), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    console.error("[Locations] write failed");
    return NextResponse.json({ error: "Could not save the location." }, { status: 503 });
  }
}

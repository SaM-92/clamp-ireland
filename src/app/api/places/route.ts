import { NextResponse } from "next/server";
import { searchPlacesResilient } from "@/modules/map/lib/geocodeProviders";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().replace(/\s+/g, " ") ?? "";
  if (query.length < 3 || query.length > 120) {
    return NextResponse.json({ error: "Enter between 3 and 120 characters, such as Main Street, Naas." }, { status: 400 });
  }
  try {
    const results = await searchPlacesResilient(query);
    return NextResponse.json(results, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch (error) {
    console.error("[PlaceSearch] all providers failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Place search is unavailable right now. Try again, or use the city list and move the map." }, { status: 502 });
  }
}

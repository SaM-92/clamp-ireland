import { NextResponse } from "next/server";
import { IRELAND_BOUNDS, parsePlaces } from "@/modules/map/lib/searchPlaces";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().replace(/\s+/g, " ") ?? "";
  if (query.length < 3 || query.length > 120) {
    return NextResponse.json({ error: "Enter between 3 and 120 characters, such as Main Street, Naas." }, { status: 400 });
  }
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("bbox", IRELAND_BOUNDS.join(","));
  url.searchParams.set("lang", "en");
  url.searchParams.append("countrycode", "IE");
  url.searchParams.append("countrycode", "GB");
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const results = parsePlaces(await response.json());
    return NextResponse.json(results, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch (error) {
    console.error("[PlaceSearch] provider failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Place search is unavailable right now. Try again, or use the city list and move the map." }, { status: 502 });
  }
}

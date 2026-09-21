"use client";

import type { LocationSummary } from "./types";

/** Public, unauthenticated read of every location pin and its cached risk info. */
export async function fetchLocations(): Promise<LocationSummary[]> {
  const res = await fetch("/api/locations");
  if (!res.ok) throw new Error("Failed to load locations");
  return res.json();
}

/**
 * Finds an existing pin within ~30m of (lat, lng) or creates a new one.
 * Requires a signed-in user's access token — see docs/00-product-plan.md,
 * "Anti-bot / anti-abuse approach".
 */
export async function ensureLocation(
  lat: number,
  lng: number,
  accessToken: string
): Promise<LocationSummary> {
  const res = await fetch("/api/locations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to create location");
  }
  return res.json();
}

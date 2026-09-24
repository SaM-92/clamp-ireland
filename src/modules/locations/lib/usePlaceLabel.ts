"use client";

import { useEffect, useState } from "react";

export interface PlaceLabel {
  name: string;
  address: string;
}

const cache = new Map<string, PlaceLabel | null>();
const inFlight = new Map<string, Promise<PlaceLabel | null>>();

function keyFor(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

async function resolve(lat: number, lng: number, key: string): Promise<PlaceLabel | null> {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = fetch(`/api/places/reverse?lat=${lat}&lng=${lng}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { name?: string | null; address?: string | null } | null) => {
      const label = data?.name ? { name: data.name, address: data.address ?? "" } : null;
      cache.set(key, label);
      return label;
    })
    .catch(() => {
      cache.set(key, null);
      return null;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** Resolves a reported spot's coordinates to a street/place name via the free OSM-based geocoder, with an in-memory cache so each spot is only looked up once per session. */
export function usePlaceLabel(lat: number, lng: number): PlaceLabel | null {
  const key = keyFor(lat, lng);
  const [resolved, setResolved] = useState<PlaceLabel | null>(null);

  useEffect(() => {
    if (cache.has(key)) return;
    let active = true;
    void resolve(lat, lng, key).then((result) => { if (active) setResolved(result); });
    return () => { active = false; };
  }, [key, lat, lng]);

  return cache.has(key) ? cache.get(key) ?? null : resolved;
}

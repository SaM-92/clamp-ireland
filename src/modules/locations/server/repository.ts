import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database, writeTransaction } from "@/lib/db/server";
import { boundingBox, distanceMetres } from "../../../../database/sql-store.mjs";
import type { LocationSummary } from "../types";

const locationSchema = z.object({
  id: z.uuid(), lat: z.number(), lng: z.number(), riskScore: z.number(),
  riskLevel: z.enum(["low", "medium", "high"]), reportCount: z.number().int().nonnegative(),
});
const projection = "id,lat,lng,risk_score AS riskScore,risk_level AS riskLevel,report_count AS reportCount";
const insertedProjection = "inserted.id,inserted.lat,inserted.lng,inserted.risk_score AS riskScore,inserted.risk_level AS riskLevel,inserted.report_count AS reportCount";

export async function listPublicLocations(): Promise<LocationSummary[]> {
  const db = await database();
  return z.array(locationSchema).parse(await db.prepare(`SELECT ${projection} FROM locations WHERE report_count>0 ORDER BY id`).all());
}

/** No SQL geodesic function exists in Azure SQL: a coarse SQL bounding box
 * narrows candidates, then the exact WGS84 distance (same geographiclib-geodesic
 * math as before) is applied and sorted in JS, preserving the exact 30m cutoff. */
export async function findOrCreateLocation(lat: number, lng: number): Promise<LocationSummary> {
  z.number().min(-90).max(90).parse(lat);
  z.number().min(-180).max(180).parse(lng);
  const box = boundingBox(lat, lng, 60);
  return writeTransaction(async (db) => {
    const candidates = z.array(locationSchema).parse(await db.prepare(`SELECT ${projection} FROM locations
      WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`).all(box.minLat, box.maxLat, box.minLng, box.maxLng));
    const nearest = candidates
      .map((candidate) => ({ candidate, distance: distanceMetres(candidate.lat, candidate.lng, lat, lng) }))
      .filter((entry) => entry.distance <= 30.000001)
      .sort((a, b) => a.distance - b.distance || (a.candidate.id < b.candidate.id ? -1 : 1))[0];
    if (nearest) return nearest.candidate;
    const now = new Date().toISOString();
    const created = await db.prepare(`INSERT INTO locations(id,lat,lng,created_at,updated_at)
      OUTPUT ${insertedProjection} VALUES (?,?,?,?,?)`).get(randomUUID(), lat, lng, now, now);
    return locationSchema.parse(created);
  });
}

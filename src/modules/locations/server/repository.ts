import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database, writeTransaction } from "@/lib/db/server";
import type { LocationSummary } from "../types";

const locationSchema = z.object({
  id: z.uuid(), lat: z.number(), lng: z.number(), riskScore: z.number(),
  riskLevel: z.enum(["low", "medium", "high"]), reportCount: z.number().int().nonnegative(),
});
const projection = "id,lat,lng,risk_score AS riskScore,risk_level AS riskLevel,report_count AS reportCount";
export function listPublicLocations(): LocationSummary[] {
  return z.array(locationSchema).parse(database().prepare(`SELECT ${projection} FROM locations WHERE report_count>0 ORDER BY id`).all());
}
export function findOrCreateLocation(lat: number, lng: number): LocationSummary {
  z.number().min(-90).max(90).parse(lat);
  z.number().min(-180).max(180).parse(lng);
  return writeTransaction((db) => {
    const existing = db.prepare(`SELECT ${projection} FROM locations WHERE distance_m(lat,lng,?,?)<=30.000001
      ORDER BY distance_m(lat,lng,?,?),id LIMIT 1`).get(lat, lng, lat, lng);
    if (existing) return locationSchema.parse(existing);
    return locationSchema.parse(db.prepare(`INSERT INTO locations(id,lat,lng) VALUES (?,?,?) RETURNING ${projection}`).get(randomUUID(), lat, lng));
  });
}

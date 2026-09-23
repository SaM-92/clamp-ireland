import "server-only";
import { z } from "zod";
import { database, writeTransaction } from "@/lib/db/server";
import { trafficEventSchema, trafficSummarySchema, type TrafficEvent, type TrafficSummary } from "../types";

export async function incrementTraffic(event: TrafficEvent): Promise<void> {
  const { route, viewport } = trafficEventSchema.parse(event);
  await writeTransaction(async (db) => {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    await db.prepare("DELETE FROM traffic_daily WHERE day<?").run(cutoff);
    await db.prepare(`MERGE INTO traffic_daily WITH (HOLDLOCK) AS target
      USING (SELECT ? AS day,? AS route,? AS viewport) AS source
      ON target.day=source.day AND target.route=source.route AND target.viewport=source.viewport
      WHEN MATCHED THEN UPDATE SET pageviews=target.pageviews+1
      WHEN NOT MATCHED THEN INSERT (day,route,viewport,pageviews) VALUES (source.day,source.route,source.viewport,1);`)
      .run(today, route, viewport);
  });
}

const rowsSchema = z.array(z.object({
  day: z.iso.date(),
  route: trafficEventSchema.shape.route,
  viewport: trafficEventSchema.shape.viewport,
  pageviews: z.coerce.number().int().positive().safe(),
})).max(180);

/** Caller must requireAdmin first. UTC today plus the previous 29 days only. */
export async function getTrafficSummary(now = new Date()): Promise<TrafficSummary> {
  const through = now.toISOString().slice(0, 10);
  const start = new Date(`${through}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  const from = start.toISOString().slice(0, 10);
  const db = await database();
  const data = await db.prepare(`SELECT TOP (180) day,route,viewport,pageviews FROM traffic_daily
    WHERE day>=? AND day<=? ORDER BY day DESC`).all(from, through);
  const rows = rowsSchema.parse(data);
  const days = new Map<string, { day: string; pageviews: number; mobilePageviews: number }>();
  let totalPageviews = 0;
  let mobilePageviews = 0;
  for (const row of rows) {
    if (row.day < from || row.day > through) throw new Error("Traffic date outside requested window.");
    const day = days.get(row.day) ?? { day: row.day, pageviews: 0, mobilePageviews: 0 };
    day.pageviews += row.pageviews;
    totalPageviews += row.pageviews;
    if (row.viewport === "mobile") {
      day.mobilePageviews += row.pageviews;
      mobilePageviews += row.pageviews;
    }
    days.set(row.day, day);
  }
  return trafficSummarySchema.parse({
    enabled: true, from, through, totalPageviews, mobilePageviews,
    days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
  });
}

import "server-only";
import { z } from "zod";
import { database, writeTransaction } from "@/lib/db/server";
import { trafficEventSchema, trafficSummarySchema, type TrafficEvent, type TrafficSummary } from "../types";

export async function incrementTraffic(event: TrafficEvent): Promise<void> {
  const { route, viewport } = trafficEventSchema.parse(event);
  writeTransaction((db) => {
    db.prepare("DELETE FROM traffic_daily WHERE day<date('now','-29 days')").run();
    db.prepare(`INSERT INTO traffic_daily(day,route,viewport,pageviews) VALUES (date('now'),?,?,1)
      ON CONFLICT(day,route,viewport) DO UPDATE SET pageviews=pageviews+1`).run(route, viewport);
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
  const data = database().prepare(`SELECT day,route,viewport,pageviews FROM traffic_daily
    WHERE day>=? AND day<=? ORDER BY day DESC LIMIT 180`).all(from, through);
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

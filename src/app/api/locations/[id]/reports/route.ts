import { NextResponse } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/env";
import { database } from "@/lib/db/server";
import { voteCountsSchema } from "@/modules/votes/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid location." }, { status: 400 });
  if (!isDatabaseConfigured) return NextResponse.json([]);
  try {
    const db = await database();
    const rows = await db.prepare(`SELECT TOP (50) id,reporter_type AS reporterType,description,incident_date AS incidentDate,
      created_at AS createdAt,agree_count,disagree_count FROM reports_public WHERE location_id=? ORDER BY created_at DESC,id DESC`).all(id);
    return NextResponse.json(rows.map((row: Record<string, unknown>) => z.strictObject({
      id: z.uuid(), reporterType: z.enum(["victim", "neighbour", "witness"]), description: z.string(),
      incidentDate: z.string().nullable(), createdAt: z.string(), voteCounts: voteCountsSchema,
    }).parse({
      id: row.id, reporterType: row.reporterType, description: row.description, incidentDate: row.incidentDate,
      createdAt: row.createdAt, voteCounts: { agreeCount: row.agree_count, disagreeCount: row.disagree_count },
    })));
  } catch {
    console.error("[PublicReports] read failed");
    return NextResponse.json({ error: "Could not load approved notes." }, { status: 503 });
  }
}

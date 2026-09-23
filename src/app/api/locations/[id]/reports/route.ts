import { NextResponse } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/env";
import { database } from "@/lib/db/server";
import { voteCountsSchema } from "@/modules/votes/types";
import { getSignedPublishedPhotoUrl } from "@/modules/reports/server/imageStorage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid location." }, { status: 400 });
  if (!isDatabaseConfigured) return NextResponse.json([]);
  try {
    const db = await database();
    const rows = await db.prepare(`SELECT TOP (50) id,reporter_type AS reporterType,description,incident_date AS incidentDate,
      created_at AS createdAt,agree_count,disagree_count,has_image,image_url,is_anonymous,nickname FROM reports_public WHERE location_id=? ORDER BY created_at DESC,id DESC`).all(id);
    const notes = await Promise.all(rows.map(async (row: Record<string, unknown>) => {
      let imageUrl: string | null = null;
      if (row.has_image && row.image_url) {
        try { imageUrl = await getSignedPublishedPhotoUrl(row.image_url as string); }
        catch (error) { console.error("[PublicReports] photo sign failed", row.id, error); }
      }
      return z.strictObject({
        id: z.uuid(), reporterType: z.enum(["victim", "neighbour", "witness"]), description: z.string(),
        incidentDate: z.string().nullable(), createdAt: z.string(), voteCounts: voteCountsSchema,
        imageUrl: z.string().nullable(), isAnonymous: z.boolean(), nickname: z.string().nullable(),
      }).parse({
        id: row.id, reporterType: row.reporterType, description: row.description, incidentDate: row.incidentDate,
        createdAt: row.createdAt, voteCounts: { agreeCount: row.agree_count, disagreeCount: row.disagree_count },
        imageUrl, isAnonymous: row.is_anonymous === 1 || row.is_anonymous === true, nickname: row.nickname ?? null,
      });
    }));
    return NextResponse.json(notes);
  } catch {
    console.error("[PublicReports] read failed");
    return NextResponse.json({ error: "Could not load approved notes." }, { status: 503 });
  }
}

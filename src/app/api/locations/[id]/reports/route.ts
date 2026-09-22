import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { createAnonServerClient } from "@/lib/supabase/server";
import type { PublicReport } from "@/modules/reports/types";
import { voteCountsSchema } from "@/modules/votes/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid location." }, { status: 400 });
  if (!isSupabaseConfigured) return NextResponse.json([]);
  const { data, error } = await createAnonServerClient()
    .from("reports_public")
    .select("id, reporter_type, description, incident_date, created_at, agree_count, disagree_count")
    .eq("location_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[PublicReports] read failed", error.code);
    return NextResponse.json({ error: "Could not load approved notes." }, { status: 500 });
  }
  const counts = z.array(voteCountsSchema).safeParse((data ?? []).map((row) => ({
    agreeCount: row.agree_count, disagreeCount: row.disagree_count,
  })));
  if (!counts.success) {
    console.error("[PublicReports] invalid feedback counts");
    return NextResponse.json({ error: "Could not load approved notes and feedback." }, { status: 500 });
  }
  const reports: PublicReport[] = (data ?? []).map((row, index) => ({
    id: row.id, reporterType: row.reporter_type, description: row.description ?? "",
    incidentDate: row.incident_date, createdAt: row.created_at,
    voteCounts: counts.data[index],
  }));
  return NextResponse.json(reports);
}

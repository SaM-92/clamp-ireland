import { NextResponse } from "next/server";
import { getTransparencyStats } from "@/modules/dashboard/server/stats";

export async function GET() {
  const stats = await getTransparencyStats();
  return NextResponse.json(stats);
}

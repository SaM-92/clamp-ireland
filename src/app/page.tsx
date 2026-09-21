import { HomeClient } from "./HomeClient";
import { getTransparencyStats } from "@/modules/dashboard/server/stats";

// Avoid attempting static prerendering against a live database at build
// time — stats are fetched fresh per request (and degrade gracefully to
// zeros if Supabase isn't configured yet, see modules/dashboard/server/stats.ts).
export const dynamic = "force-dynamic";

export default async function Home() {
  const stats = await getTransparencyStats();
  return <HomeClient initialStats={stats} />;
}

import { HomeClient } from "./HomeClient";
import { getTransparencyStats } from "@/modules/dashboard/server/stats";
import { isSupabaseConfigured } from "@/lib/env";
import { seoPolicy } from "@/modules/seo/config";
import { publicPageMetadata, websiteStructuredData } from "@/modules/seo/policy";
import { localAiDemoEnabled } from "@/modules/ai-demo/server/guard";

export const metadata = publicPageMetadata(
  seoPolicy,
  "/",
  "Clamp Transparency Signal | Community clamping map",
  "Browse community-reported clamping hotspots across Ireland, share an experience, and find a Republic of Ireland clamping appeal guide. Reports are not verified findings.",
);

// Avoid attempting static prerendering against a live database at build
// time — stats are fetched fresh per request (and degrade gracefully to
// zeros if Supabase isn't configured yet, see modules/dashboard/server/stats.ts).
export const dynamic = "force-dynamic";

export default async function Home() {
  const stats = await getTransparencyStats();
  const website = websiteStructuredData(seoPolicy);
  return (
    <>
      {website && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(website).replace(/</g, "\\u003c") }}
        />
      )}
      <HomeClient initialStats={stats} preview={process.env.NODE_ENV === "development" && !isSupabaseConfigured} aiDemo={localAiDemoEnabled()} />
    </>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/lib/components/Icon";
import { PRIVATE_ROBOTS } from "@/modules/seo/policy";

export const metadata: Metadata = {
  title: "Thank you | clamptracker.ie",
  robots: PRIVATE_ROBOTS,
};

export default function SupportThanksPage() {
  return (
    <main id="main-content" className="auth-shell">
      <p className="eyebrow"><Icon name="heart" width="14" height="14" /> Thank you</p>
      <h1>Your support keeps the map free.</h1>
      <p className="auth-description">
        Your contribution has been received. It goes straight towards hosting, the free map tiles and
        keeping clamptracker.ie ad-free and community-run.
      </p>
      <Link href="/" className="button button-primary">Back to the map</Link>
    </main>
  );
}

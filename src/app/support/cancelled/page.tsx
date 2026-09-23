import Link from "next/link";
import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/modules/seo/policy";

export const metadata: Metadata = {
  title: "Support cancelled | clamptracker.ie",
  robots: PRIVATE_ROBOTS,
};

export default function SupportCancelledPage() {
  return (
    <main id="main-content" className="auth-shell">
      <p className="eyebrow">No charge made</p>
      <h1>Checkout cancelled.</h1>
      <p className="auth-description">
        No payment was taken. You can support clamptracker.ie any time from the button in the header.
      </p>
      <Link href="/" className="button button-primary">Back to the map</Link>
    </main>
  );
}

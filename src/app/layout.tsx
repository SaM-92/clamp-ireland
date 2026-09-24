import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { DonateButton } from "@/modules/donations/components/DonateButton";
import { AccountMenu } from "@/modules/auth/components/AccountMenu";
import { seoPolicy } from "@/modules/seo/config";
import { PRIVATE_ROBOTS } from "@/modules/seo/policy";
import { TrafficTracker } from "@/modules/analytics/components/TrafficTracker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clamp Transparency Signal",
  description:
    "A community reporting map for clamping hotspots in Ireland — report what happened, help others avoid it.",
  manifest: "/manifest.json",
  ...(seoPolicy.origin ? { metadataBase: new URL(seoPolicy.origin) } : {}),
  robots: seoPolicy.indexEnabled ? { index: true, follow: true } : PRIVATE_ROBOTS,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="site-header">
          <Link href="/" className="brand" aria-label="clamptracker.ie home">
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, no need for next/image */}
              <img src="/brand/logo.svg" alt="" width={44} height={44} />
            </span>
            <span>clamptracker<span className="brand-subtitle">.ie</span></span>
          </Link>
          <nav className="header-nav" aria-label="Main navigation">
            <Link href="/#how-it-works" className="nav-explainer">How it works</Link>
            <AccountMenu />
            <DonateButton />
          </nav>
        </header>
        {children}
        <TrafficTracker />
        <footer className="site-footer">
          <span>Built for the community. Not for profit.</span>
          <nav className="footer-links" aria-label="Useful links">
            <a href="https://www.nationaltransport.ie/vehicle-clamping-regulation/">How to appeal</a>
          </nav>
          <span>Community reports, not verified findings. Always check local parking signs.</span>
        </footer>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { DonateButton } from "@/modules/donations/components/DonateButton";
import { Icon } from "@/lib/components/Icon";
import { AccountMenu } from "@/modules/auth/components/AccountMenu";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clamp Transparency Signal",
  description:
    "A community reporting map for clamping hotspots in Ireland — report what happened, help others avoid it.",
  manifest: "/manifest.json",
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
          <Link href="/" className="brand" aria-label="Clamp Transparency Signal home">
            <span className="brand-mark"><Icon name="pin" width="25" height="25" /></span>
            <span>Clamp<span className="brand-subtitle">Transparency Signal</span></span>
          </Link>
          <nav className="header-nav" aria-label="Main navigation">
            <Link href="/#how-it-works" className="nav-explainer">How it works</Link>
            <AccountMenu />
            <DonateButton />
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <span>Built for the community. Not for profit.</span>
          <span>Community reports, not verified findings. Always check local parking signs.</span>
        </footer>
      </body>
    </html>
  );
}

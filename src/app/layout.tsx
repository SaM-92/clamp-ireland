import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { DonateButton } from "@/modules/donations/components/DonateButton";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clamp Transparency Signal",
  description:
    "A community reporting map for clamping hotspots in Ireland — report what happened, help others avoid it.",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-zinc-50 dark:bg-black">
        <header className="flex h-16 items-center justify-between border-b border-black/10 px-4 dark:border-white/10">
          <Link href="/" className="font-semibold">
            🚧 Clamp Transparency Signal
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/auth/sign-in">Sign in</Link>
            <DonateButton />
          </nav>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-black/10 px-4 py-3 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
          Reports are user submissions describing personal experience at a
          location, not verified findings and not accusations against any
          named business. See our forthcoming Privacy Policy &amp; Terms of
          Service. Contact: hello@clamptransparency.example (placeholder).
        </footer>
      </body>
    </html>
  );
}


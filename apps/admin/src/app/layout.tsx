import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "@/app/globals.css";

const font = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Private administration | Clamp",
  robots: { index: false, follow: false, noarchive: true },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={font.variable} suppressHydrationWarning>
    <body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body>
  </html>;
}

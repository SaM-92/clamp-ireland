import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Administration | Clamp Ireland",
  robots: { index: false, follow: false, noarchive: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}

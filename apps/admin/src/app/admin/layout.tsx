import type { Metadata } from "next";
import { requireAdminPage } from "@admin/auth/server";
import { AdminSessionBoundary } from "@admin/auth/AdminSessionBoundary";

export const metadata: Metadata = {
  title: "Administration | Clamp Ireland",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return <AdminSessionBoundary>{children}</AdminSessionBoundary>;
}

import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";

export const requireAdminPage = cache(async () => {
  const admin = await requireAdmin(new Request("http://admin.internal/", { headers: await headers() }));
  if (!admin) redirect("/auth/sign-in");
  return admin;
});

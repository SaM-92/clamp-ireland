import { AdminNav } from "@/modules/admin/components/AdminNav";
import { AdminSummaryWorkspace } from "@/modules/area-summaries/components/AdminSummaryWorkspace";
import { getAreaSummarySetup } from "@/modules/area-summaries/server/config";
import styles from "@/modules/area-summaries/components/AreaSummaries.module.css";
import { requireAdminPage } from "@admin/auth/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review area summaries", robots: { index: false, follow: false } };

export default async function AreaSummariesPage() {
  await requireAdminPage();
  return <main id="main-content" className={styles.shell}>
    <AdminNav current="summaries" />
    <h1>Review nearby summaries</h1>
    <p>Turn our human-approved community notes within 500 metres into a short, cautious sentence. Generation creates a draft; only a separate human review can publish it.</p>
    <AdminSummaryWorkspace initialSetup={getAreaSummarySetup()} />
  </main>;
}

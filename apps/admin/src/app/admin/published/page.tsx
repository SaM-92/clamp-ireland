import { PublishedReports } from "@/modules/moderation/components/PublishedReports";
import { AdminNav } from "@/modules/admin/components/AdminNav";
import styles from "@/modules/admin/components/Admin.module.css";
import { requireAdminPage } from "@admin/auth/server";

export default async function PublishedReportsPage() {
  await requireAdminPage();
  return (
    <main id="main-content" className={styles.shell}>
      <AdminNav current="published" />
      <header className={styles.heading}>
        <h1>Published reports</h1>
        <p>
          Live notes already on the public map, including ones auto-published
          by the AI risk check. Remove anything that should not have gone
          public - it stays in the database for audit but disappears from the map.
        </p>
      </header>
      <PublishedReports />
    </main>
  );
}

import { isSupabaseConfigured } from "@/lib/env";
import { AdminDashboard } from "@/modules/admin/components/AdminDashboard";
import { AdminNav } from "@/modules/admin/components/AdminNav";
import { isAdminPreviewEnabled } from "@/modules/admin/lib/preview";
import styles from "@/modules/admin/components/Admin.module.css";

export default function AdminPage() {
  const preview = isAdminPreviewEnabled(process.env.NODE_ENV, isSupabaseConfigured);
  return (
    <main id="main-content" className={styles.shell}>
      <AdminNav current="overview" />
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Administration</p>
        <h1>Community overview</h1>
        <p>Review community reports carefully. Only approved wording contributes to the public map.</p>
      </header>
      <AdminDashboard preview={preview} />
    </main>
  );
}

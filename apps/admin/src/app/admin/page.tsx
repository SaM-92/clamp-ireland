import { AdminDashboard } from "@/modules/admin/components/AdminDashboard";
import { AdminNav } from "@/modules/admin/components/AdminNav";
import { requireAdminPage } from "@admin/auth/server";
import styles from "@/modules/admin/components/Admin.module.css";

export default async function AdminPage() {
  await requireAdminPage();
  return (
    <main id="main-content" className={styles.shell}>
      <AdminNav current="overview" />
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Administration</p>
        <h1>Community overview</h1>
        <p>Review community reports carefully. Only approved wording contributes to the public map.</p>
      </header>
      <AdminDashboard />
    </main>
  );
}

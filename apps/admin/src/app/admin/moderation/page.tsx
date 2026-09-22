import { ModerationQueue } from "@/modules/moderation/components/ModerationQueue";
import { AdminNav } from "@/modules/admin/components/AdminNav";
import styles from "@/modules/admin/components/Admin.module.css";
import { requireAdminPage } from "@admin/auth/server";

export default async function ModerationPage() {
  await requireAdminPage();
  return (
    <main id="main-content" className={styles.shell}>
      <AdminNav current="moderation" />
      <header className={styles.heading}>
        <h1>Moderation queue</h1>
        <p>
          Every note and photo stays private until reviewed. Edit identifying
          or accusatory text before approval. Reject photos requiring redaction;
          there is no image-blurring tool in this prototype.
        </p>
      </header>
      <ModerationQueue />
    </main>
  );
}

import Link from "next/link";
import styles from "./Admin.module.css";

export function AdminNav({ current }: { current: "overview" | "moderation" | "summaries" }) {
  return (
    <nav aria-label="Administration" className={styles.nav}>
      <Link href="/admin" aria-current={current === "overview" ? "page" : undefined}>Overview</Link>
      <Link href="/admin/moderation" aria-current={current === "moderation" ? "page" : undefined}>Moderation queue</Link>
      <Link href="/admin/summaries" aria-current={current === "summaries" ? "page" : undefined}>Area summaries</Link>
      <Link href="/">Back to map</Link>
    </nav>
  );
}

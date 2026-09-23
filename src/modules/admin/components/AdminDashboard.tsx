"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ModerationQueue } from "@/modules/moderation/components/ModerationQueue";
import { adminOverviewSchema, type AdminOverview } from "../types";
import styles from "./Admin.module.css";
import { TrafficPanel } from "./TrafficPanel";

function OverviewCards({ overview }: { overview: AdminOverview }) {
  const cards = [
    ["Pending review", overview.pending],
    ["Published", overview.published],
    ["Auto-published by AI", overview.autoPublished],
    ["Rejected", overview.rejected],
    ["Total reports", overview.totalReports],
    ["User profiles", overview.totalUsers],
  ] as const;
  return (
    <dl className={styles.cards} aria-label="Report and user counts">
      {cards.map(([label, value]) => <div key={label} className={styles.card}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

export function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      try {
        const response = await fetch("/api/admin/overview", {
          credentials: "same-origin",
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (!controller.signal.aborted) setAccessDenied(true);
            throw new Error("Sign in with an administrator account to view private reports and counts.");
          }
          throw new Error("Could not load the admin overview. Check your connection and server configuration, then try again.");
        }
        const data = adminOverviewSchema.parse(await response.json());
        if (!controller.signal.aborted) setOverview(data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setOverview(null);
          setError(cause instanceof Error ? cause.message : "Could not load the admin overview.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [version]);
  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        <button className="button button-surface" disabled={loading} onClick={() => setVersion((value) => value + 1)}>Refresh overview</button>
        <p className={styles.hint}>Private administrator workspace</p>
      </div>
      {loading && <p role="status">Loading admin overview...</p>}
      {error && <section className={styles.panel}>
        <p className="form-error" role="alert">{error}</p>
        {accessDenied && <Link className="text-button" href="/auth/sign-in">Sign in as an administrator</Link>}
      </section>}
      {overview && !error && <>
        <OverviewCards overview={overview} />
        <p className={styles.hint}>Pending and published exclude removed reports. Rejected and total reports include soft removals. User totals count registered profiles, not active users.</p>
        <TrafficPanel />
        <section aria-labelledby="review-heading">
          <div className={styles.sectionHeading}><h2 id="review-heading">Needs review</h2><Link className="text-button" href="/admin/moderation">Open moderation queue</Link></div>
          <ModerationQueue onDecisionSaved={() => setVersion((value) => value + 1)} />
        </section>
      </>}
    </div>
  );
}

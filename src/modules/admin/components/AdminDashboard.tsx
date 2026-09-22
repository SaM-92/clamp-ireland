"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createBrowserClient } from "@/lib/supabase/client";
import { getAccessToken } from "@/modules/auth/lib/supabaseAuth";
import { ModerationQueue } from "@/modules/moderation/components/ModerationQueue";
import { loadPreviewReports, type PreviewReport } from "@/modules/reports/lib/previewReports";
import { adminOverviewSchema, type AdminOverview } from "../types";
import styles from "./Admin.module.css";
import { TrafficPanel } from "./TrafficPanel";

function OverviewCards({ overview, preview = false }: { overview: AdminOverview; preview?: boolean }) {
  const cards = [
    ["Pending review", overview.pending],
    [preview ? "Simulated approval" : "Published", overview.published],
    ["Rejected", overview.rejected],
    ["Total reports", overview.totalReports],
    ["User profiles", preview ? "N/A" : overview.totalUsers],
  ] as const;
  return (
    <dl className={styles.cards} aria-label={preview ? "Local preview counts" : "Report and user counts"}>
      {cards.map(([label, value]) => <div key={label} className={styles.card}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

function LocalDashboard() {
  const [reports, setReports] = useState<PreviewReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    function load() {
      try {
        setReports(loadPreviewReports());
        setError(null);
      } catch (cause) {
        setReports(null);
        console.error("[Admin preview] could not read local reports", cause);
        setError("Could not read local preview reports. Check browser storage access, or use Reset preview on the map if the saved data is invalid.");
      }
    }
    load();
    window.addEventListener("storage", load);
    window.addEventListener("focus", load);
    return () => { window.removeEventListener("storage", load); window.removeEventListener("focus", load); };
  }, []);
  return (
    <div className={styles.stack}>
      <aside className={styles.banner} aria-label="Local dashboard preview">
        <h2>Local dashboard preview · Read-only</h2>
        <p>Only test reports saved in this browser are shown. All approvals are simulated; nothing here is a real moderation decision or a live incident count.</p>
        <p>Photo files were not retained in local preview, so evidence cannot be reviewed. No accounts or user totals are stored locally.</p>
        <p className={styles.hint}>This preview is available only in development without Supabase public configuration. Live moderation always requires an administrator account.</p>
      </aside>
      <TrafficPanel preview />
      {error && <div className={styles.panel}><p className="form-error" role="alert">{error}</p><Link className="text-button" href="/">Return to the map</Link></div>}
      {!reports && !error && <p role="status">Reading local preview reports...</p>}
      {reports && <>
        <OverviewCards preview overview={{ pending: 0, published: reports.length, rejected: 0, totalReports: reports.length, totalUsers: 0 }} />
        <section aria-labelledby="local-notes-heading">
          <div className={styles.sectionHeading}><h2 id="local-notes-heading">Local preview notes</h2><Link className="text-button" href="/">Add test reports on the map</Link></div>
          {reports.length === 0 ? <p className={styles.panel}>No local test reports yet. Reports you save in the map preview will appear here.</p> :
            <ul className={styles.notes}>{[...reports].reverse().map((report) => (
              <li key={report.id} className={styles.note}>
                <div className={styles.noteMeta}><span>{report.reporterType} · Simulated approval</span><time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString()}</time></div>
                <p>{report.description}</p>
                {report.incidentDate && <p className={styles.hint}>Incident date: {report.incidentDate}</p>}
                {report.hasImage && <p className={styles.hint}>Photo selected during entry, but the file was not retained. No evidence is available.</p>}
              </li>
            ))}</ul>}
        </section>
      </>}
    </div>
  );
}

function LiveDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [sessionVersion, setSessionVersion] = useState(0);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const { data } = createBrowserClient().auth.onAuthStateChange(() => {
      setOverview(null);
      setSessionVersion((value) => value + 1);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      try {
        const token = await getAccessToken();
        const response = await fetch("/api/admin/overview", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  }, [version, sessionVersion]);
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
        <TrafficPanel key={sessionVersion} />
        <section aria-labelledby="review-heading">
          <div className={styles.sectionHeading}><h2 id="review-heading">Needs review</h2><Link className="text-button" href="/admin/moderation">Open moderation queue</Link></div>
          <ModerationQueue key={sessionVersion} onDecisionSaved={() => setVersion((value) => value + 1)} />
        </section>
      </>}
    </div>
  );
}

export function AdminDashboard({ preview }: { preview: boolean }) {
  return preview ? <LocalDashboard /> : <LiveDashboard />;
}

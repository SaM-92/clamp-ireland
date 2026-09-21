"use client";

import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "@/modules/auth/lib/supabaseAuth";
import type { PendingReport } from "../types";

export function ModerationQueue() {
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const token = await getAccessToken();
      if (cancelled) return;
      if (!token) {
        setError("Sign in as an admin to view the moderation queue.");
        setLoading(false);
        return;
      }
      const res = await fetch("/api/moderation/reports", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled) return;
      if (!res.ok) {
        setError("You do not have access to the moderation queue.");
        setLoading(false);
        return;
      }
      setReports(await res.json());
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [version]);

  async function act(id: string, action: "approve" | "reject") {
    const token = await getAccessToken();
    if (!token) return;
    await fetch(`/api/moderation/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
    });
    refresh();
  }

  if (loading) return <p>Loading moderation queue…</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (reports.length === 0) return <p>No reports waiting for review. 🎉</p>;

  return (
    <ul className="flex flex-col gap-4">
      {reports.map((report) => (
        <li key={report.id} className="rounded border p-4">
          <p className="text-sm text-black/60">
            {report.reporterType} · {new Date(report.createdAt).toLocaleString()}
          </p>
          <p className="my-2">{report.description}</p>
          {report.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- moderator-only preview, not public
            <img
              src={report.imageUrl}
              alt="Submitted evidence pending redaction"
              className="mb-2 max-h-64 rounded"
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => act(report.id, "approve")}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white"
            >
              Approve &amp; publish
            </button>
            <button
              onClick={() => act(report.id, "reject")}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white"
            >
              Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { getSession, subscribeAuth } from "@/modules/auth/lib/session";
import { fetchOwnReportVotes, VoteHttpError } from "./api";
import type { ReportVote, VoteSnapshot, VoteViewer } from "./types";

type Batch =
  | { key: string; status: "loading" | "signed-out" }
  | { key: string; status: "error"; message: string }
  | { key: string; status: "ready"; votes: Record<string, ReportVote | null> };

export function useReportVoteViewer(reportIds: string[], preview: boolean) {
  const key = reportIds.join(",");
  const [batch, setBatch] = useState<Batch>({ key: "", status: "loading" });
  const [revision, setRevision] = useState(0);
  const authRevision = useRef(0);

  useEffect(() => {
    if (preview) return;
    return subscribeAuth(() => {
      authRevision.current += 1;
      setBatch({ key: "", status: "loading" });
      setRevision((value) => value + 1);
    });
  }, [preview]);

  useEffect(() => {
    if (preview || !key) return;
    const controller = new AbortController();
    const currentAuthRevision = authRevision.current;
    const cancelled = () => controller.signal.aborted || currentAuthRevision !== authRevision.current;
    async function load() {
      setBatch({ key, status: "loading" });
      try {
        const session = await getSession(controller.signal);
        if (cancelled()) return;
        if (!session.signedIn) {
          setBatch({ key, status: "signed-out" });
          return;
        }
        const votes = await fetchOwnReportVotes(key.split(","), controller.signal);
        if (!cancelled()) setBatch({
          key, status: "ready",
          votes: Object.fromEntries(votes.map((row) => [row.reportId, row.vote])),
        });
      } catch (error) {
        if (!cancelled()) setBatch(error instanceof VoteHttpError && error.status === 401
          ? { key, status: "signed-out" }
          : { key, status: "error", message: error instanceof Error ? error.message : "Could not load your votes." });
      }
    }
    void load();
    return () => controller.abort();
  }, [key, preview, revision]);

  function viewerFor(reportId: string): VoteViewer {
    if (batch.key !== key) return { status: "loading" };
    if (batch.status === "ready") {
      if (!Object.hasOwn(batch.votes, reportId)) return { status: "error", message: "This note is no longer available for voting. Reload notes." };
      return { status: "ready", vote: batch.votes[reportId] };
    }
    return batch.status === "error" ? { status: "error", message: batch.message } : { status: batch.status };
  }

  function recordVote(snapshot: VoteSnapshot) {
    setBatch((current) => current.status === "ready" && current.key === key && Object.hasOwn(current.votes, snapshot.reportId)
      ? { ...current, votes: { ...current.votes, [snapshot.reportId]: snapshot.vote } } : current);
  }

  function retry() {
    setBatch({ key: "", status: "loading" });
    setRevision((value) => value + 1);
  }
  return { viewerFor, recordVote, retry };
}

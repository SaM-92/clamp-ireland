"use client";

import { useEffect, useRef, useState } from "react";
import { saveReportVote, VoteHttpError } from "../api";
import { loadPreviewVote, savePreviewVote, PREVIEW_VOTES_EVENT, PREVIEW_VOTES_KEY } from "../preview";
import type { ReportVote, VoteCounts, VoteSnapshot, VoteViewer } from "../types";
import styles from "./ReportVotes.module.css";

export type ReportVotesProps = {
  reportId: string;
  counts: VoteCounts;
  onChange?: (snapshot: VoteSnapshot) => void;
  onRetry?: () => void;
} & (
  | { preview: true; viewer?: never }
  | { preview?: false; viewer: VoteViewer }
);

export function ReportVotes(props: ReportVotesProps) {
  const identity = props.preview ? "preview"
    : props.viewer.status === "ready" ? props.viewer.accessToken : props.viewer.status;
  return <VoteControls key={`${props.reportId}:${identity}`} {...props} />;
}

function VoteControls({ reportId, counts, preview, viewer, onChange, onRetry }: ReportVotesProps) {
  const viewerVote = viewer?.status === "ready" ? viewer.vote : null;
  const [snapshot, setSnapshot] = useState<VoteSnapshot>({ reportId, ...counts, vote: viewerVote });
  const [source, setSource] = useState({ ...counts, vote: viewerVote });
  const [previewReady, setPreviewReady] = useState(!preview);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  if (!preview && (source.agreeCount !== counts.agreeCount || source.disagreeCount !== counts.disagreeCount || source.vote !== viewerVote)) {
    setSource({ ...counts, vote: viewerVote });
    setSnapshot((current) => ({
      ...current,
      ...(source.agreeCount !== counts.agreeCount || source.disagreeCount !== counts.disagreeCount ? counts : {}),
      ...(source.vote !== viewerVote ? { vote: viewerVote } : {}),
    }));
  }
  useEffect(() => {
    if (!preview) return;
    function load() {
      try {
        setSnapshot(loadPreviewVote(reportId));
        setPreviewReady(true);
        setError(null);
      } catch (cause) {
        setPreviewReady(false);
        setError(cause instanceof Error ? cause.message : "Could not read preview votes.");
      }
    }
    function storageChanged(event: StorageEvent) {
      if (event.key === null || event.key === PREVIEW_VOTES_KEY) load();
    }
    load();
    window.addEventListener(PREVIEW_VOTES_EVENT, load);
    window.addEventListener("storage", storageChanged);
    return () => {
      window.removeEventListener(PREVIEW_VOTES_EVENT, load);
      window.removeEventListener("storage", storageChanged);
    };
  }, [preview, reportId, retry]);

  async function choose(vote: ReportVote) {
    if (inFlight.current || (!preview && viewer?.status !== "ready")) return;
    const nextVote = snapshot.vote === vote ? null : vote;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage("");
    let saved: VoteSnapshot;
    try {
      if (preview) saved = savePreviewVote(reportId, nextVote);
      else if (viewer?.status === "ready") saved = await saveReportVote(reportId, nextVote, viewer.accessToken);
      else throw new Error("Sign in with a confirmed account to vote.");
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : "Could not save feedback. Please try again.");
        if (cause instanceof VoteHttpError && cause.status === 401) setAuthNeeded(true);
        if (cause instanceof VoteHttpError && cause.status === 404) setUnavailable(true);
      }
      return;
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
    if (!active.current) return;
    setSnapshot(saved);
    setMessage(nextVote === null ? "Your feedback was removed." : "Your feedback was saved.");
    onChange?.(saved);
  }

  const signedOut = !preview && (authNeeded || viewer?.status === "signed-out");
  const loading = !preview && viewer?.status === "loading";
  const readError = viewer?.status === "error" ? viewer.message : null;
  const disabled = busy || loading || signedOut || unavailable || Boolean(readError) || !previewReady;
  const selected = !authNeeded && !unavailable ? snapshot.vote : null;
  return (
    <section className={styles.votes} role="group" aria-label="Community feedback on this note" aria-busy={busy || loading}>
      <div className={styles.buttons}>
        <button type="button" aria-pressed={selected === "agree"} disabled={disabled} onClick={() => void choose("agree")}>
          Agreed <span>{preview && !previewReady ? "-" : snapshot.agreeCount}</span>
        </button>
        <button type="button" aria-pressed={selected === "disagree"} disabled={disabled} onClick={() => void choose("disagree")}>
          Disagreed <span>{preview && !previewReady ? "-" : snapshot.disagreeCount}</span>
        </button>
      </div>
      <p className={styles.hint}>Community feedback only, not proof. Votes do not change the risk signal, report count or summary sources.</p>
      {preview && <p className={styles.hint}>Local preview: one simulated voter in this browser. No vote is submitted.</p>}
      {signedOut && <p className={styles.hint}><a href="/auth/sign-in">Sign in to vote</a> with a confirmed account.</p>}
      {(error || readError) && <p role="alert" className={styles.error}>{error ?? readError}</p>}
      {((preview && error) || (onRetry && (readError || authNeeded))) && (
        <button type="button" className={styles.retry} disabled={busy} onClick={() => preview ? setRetry((value) => value + 1) : onRetry?.()}>
          Retry your feedback
        </button>
      )}
      <p role="status" className={styles.hint}>{busy ? "Saving feedback..." : loading ? "Loading your feedback..." : message}</p>
    </section>
  );
}

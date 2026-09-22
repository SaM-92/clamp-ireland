"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/components/Icon";
import type { LocationSummary } from "@/modules/locations/types";
import type { PublicReport, ReporterType } from "../types";
import { NearbySummary } from "@/modules/area-summaries/components/NearbySummary";
import { ReportVotes } from "@/modules/votes/components/ReportVotes";
import { useReportVoteViewer } from "@/modules/votes/useReportVoteViewer";
import type { VoteSnapshot } from "@/modules/votes/types";

const REPORTER_LABELS: Record<ReporterType, string> = {
  victim: "Personal experience", neighbour: "Local resident", witness: "Witness",
};

export function LocationNotes({ location, previewNotes, onClose, onReport }: {
  location: LocationSummary;
  previewNotes: PublicReport[] | null;
  onClose: () => void;
  onReport: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState<PublicReport[]>([]);
  const [loading, setLoading] = useState(previewNotes === null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const preview = previewNotes !== null;
  const voting = useReportVoteViewer(preview ? [] : notes.map((note) => note.id), preview);

  function feedbackSaved(snapshot: VoteSnapshot) {
    voting.recordVote(snapshot);
    setNotes((current) => current.map((note) => note.id === snapshot.reportId
      ? { ...note, voteCounts: { agreeCount: snapshot.agreeCount, disagreeCount: snapshot.disagreeCount } }
      : note));
  }

  useEffect(() => {
    if (preview) return;
    const request = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/locations/${location.id}/reports`, { signal: request.signal });
        if (!response.ok) throw new Error("Could not load approved notes. Please try again.");
        const data = await response.json();
        if (!request.signal.aborted) setNotes(data);
      } catch (cause) {
        if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load notes.");
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => request.abort();
  }, [location.id, preview, retry]);
  const displayed = previewNotes ?? notes;
  return (
    <dialog ref={dialog} className="report-dialog notes-dialog" aria-labelledby="notes-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="dialog-heading">
        <div><p className="eyebrow">{preview ? "Local preview · simulated approval" : "Human-reviewed community notes"}</p>
          <h2 id="notes-title">Reports at this spot</h2>
          <p>{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</p>
        </div>
        <button className="icon-button" aria-label="Close location notes" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="notes-content">
        <p className="notes-summary"><span className={`legend-dot risk-${location.riskLevel}`} />{location.riskLevel} signal · {location.reportCount} reports · 100 m zone</p>
        <p className="field-hint">The circle shows an approximate area around the reports, not an official restriction or prediction. New notes need human approval before they count.</p>
        <NearbySummary key={`${location.id}:${preview}`} locationId={location.id} preview={preview} />
        {loading ? <p role="status">Loading notes...</p> : error ?
          <div className="form-error" role="alert">{error}<button className="text-button" onClick={() => setRetry((value) => value + 1)}>Retry notes</button></div> :
          displayed.length === 0 ? <p>No approved notes to show yet.</p> :
          <ul className="public-notes">{displayed.map((note) => (
            <li key={note.id}>
              <div><strong>{REPORTER_LABELS[note.reporterType]}</strong><time dateTime={note.incidentDate ?? note.createdAt}>{(note.incidentDate ?? note.createdAt).slice(0, 10)}</time></div>
              <p>{note.description}</p>
              {preview ? (
                <ReportVotes reportId={note.id} preview counts={{ agreeCount: 0, disagreeCount: 0 }} />
              ) : note.voteCounts ? (
                <ReportVotes reportId={note.id} counts={note.voteCounts} viewer={voting.viewerFor(note.id)}
                  onChange={feedbackSaved} onRetry={voting.retry} />
              ) : (
                <p role="alert">Feedback counts are unavailable. Close and reopen notes to retry.</p>
              )}
            </li>
          ))}</ul>}
        {displayed.length === 50 && <p className="field-hint">Showing the latest 50 approved notes.</p>}
        <button className="button button-primary" onClick={onReport}><Icon name="plus" /> Add a report here</button>
      </div>
    </dialog>
  );
}

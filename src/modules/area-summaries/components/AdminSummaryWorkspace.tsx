"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { formatDateTime } from "@/lib/dateFormat";
import {
  adminSummaryResponseSchema, summarySentenceSchema, summaryWordCount,
  AREA_SUMMARY_MAX_SENTENCE_LENGTH, AREA_SUMMARY_MAX_WORDS,
  type SummarySetup, type SummaryWorkspace,
} from "../types";
import styles from "./AreaSummaries.module.css";

const locationsSchema = z.array(z.object({
  id: z.uuid(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  reportCount: z.number().int().nonnegative(),
}));
type LocationChoice = z.infer<typeof locationsSchema>[number];
class WorkspaceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function adminRequest(url: string, signal: AbortSignal, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init, signal, cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    throw new WorkspaceError("Sign in as an admin. Your session ended or administrator access is unavailable.", response.status);
  }
  const data: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(data);
    throw new WorkspaceError(parsed.success ? parsed.data.error : "Could not complete the summary request. Retry or reload.", response.status);
  }
  return data;
}

export function AdminSummaryWorkspace({ initialSetup }: { initialSetup: SummarySetup }) {
  const [setup, setSetup] = useState(initialSetup);
  const [locations, setLocations] = useState<LocationChoice[]>([]);
  const [locationId, setLocationId] = useState("");
  const [workspace, setWorkspace] = useState<SummaryWorkspace | null>(null);
  const [sentence, setSentence] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const serial = useRef(0);
  const active = useRef<AbortController | null>(null);

  function clearPrivate() {
    setWorkspace(null); setSentence(""); setReviewed(false); setMessage(null);
  }
  function accept(data: unknown) {
    const result = adminSummaryResponseSchema.parse(data);
    setSetup(result.setup);
    setWorkspace(result.workspace);
    setSentence(result.workspace?.draft?.sentence ?? "");
    setReviewed(false);
  }
  function failed(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "Could not complete the request. Please retry.");
    if (cause instanceof WorkspaceError && (cause.status === 401 || cause.status === 403)) {
      clearPrivate(); setLocations([]); setAccessDenied(true);
    } else if (cause instanceof WorkspaceError && cause.status === 409) {
      clearPrivate();
    }
  }

  useEffect(() => {
    const requestSerial = serial;
    const pendingRequest = active;
    const current = ++serial.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    async function load() {
      setBusy(true); setError(null); setMessage(null); setAccessDenied(false);
      setWorkspace(null); setSentence(""); setReviewed(false);
      try {
        const data = adminSummaryResponseSchema.parse(await adminRequest(
          `/api/admin/area-summaries${locationId ? `?locationId=${locationId}` : ""}`, controller.signal,
        ));
        let choices: LocationChoice[] | undefined;
        if (!locationId && data.setup.state === "ready") {
          const response = await fetch("/api/admin/locations", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
          if (!response.ok) throw new Error("Could not load real locations. Reload to retry.");
          choices = locationsSchema.parse(await response.json());
        }
        if (current !== serial.current) return;
        setSetup(data.setup); setWorkspace(data.workspace);
        setSentence(data.workspace?.draft?.sentence ?? "");
        if (choices) setLocations(choices);
      } catch (cause) {
        if (current !== serial.current) return;
        setWorkspace(null); setSentence(""); setReviewed(false);
        setError(controller.signal.aborted ? "Summary workspace request timed out. Reload to retry."
          : cause instanceof Error ? cause.message : "Could not load area summaries.");
        if (cause instanceof WorkspaceError && (cause.status === 401 || cause.status === 403)) {
          setLocations([]); setAccessDenied(true);
        }
      } finally {
        window.clearTimeout(timer);
        if (current === serial.current) setBusy(false);
      }
    }
    void load();
    return () => { requestSerial.current++; pendingRequest.current?.abort(); window.clearTimeout(timer); };
  }, [locationId, revision]);

  async function act(action: "generate" | "regenerate" | "approve" | "reject") {
    if (!workspace) return;
    const current = ++serial.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 45_000);
    setBusy(true); setError(null); setMessage(null);
    try {
      if (action === "generate" || action === "regenerate") {
        const data = await adminRequest("/api/admin/area-summaries", controller.signal, {
          method: "POST", body: JSON.stringify({ locationId, regenerate: action === "regenerate" }),
        });
        if (current !== serial.current) return;
        accept(data);
        setMessage("Generation request completed. Only a current draft shown below can be reviewed; nothing was automatically published.");
      } else {
        if (!workspace.draft) return;
        await adminRequest(`/api/admin/area-summaries/${workspace.draft.id}`, controller.signal, {
          method: "PATCH", body: JSON.stringify(action === "approve" ? {
            action, sentence, sourceFingerprint: workspace.draft.source_fingerprint, reviewed,
          } : { action }),
        });
        if (current !== serial.current) return;
        clearPrivate();
        window.dispatchEvent(new Event("area-summary-changed"));
        if ("BroadcastChannel" in window) {
          const channel = new BroadcastChannel("clamp-area-summaries");
          channel.postMessage("changed"); channel.close();
        }
        const data = await adminRequest(`/api/admin/area-summaries?locationId=${locationId}`, controller.signal);
        if (current !== serial.current) return;
        accept(data);
        setMessage(action === "approve" ? "Human-reviewed summary published." : "Draft rejected. Any previous fresh approved summary was left unchanged.");
      }
    } catch (cause) {
      if (current !== serial.current) return;
      failed(controller.signal.aborted ? new Error("Request timed out. Reload before retrying; generation may already have incurred a charge.") : cause);
      setReviewed(false);
    } finally {
      window.clearTimeout(timer);
      if (current === serial.current) setBusy(false);
    }
  }

  return <div className={styles.workspace}>
    <section className={styles.card} aria-label="Summary setup">
      <p>{setup.message}</p>
      <p className="field-hint">Setup: enable ENABLE_AREA_SUMMARIES, configure Azure SQL and the server-side AI provider, then sign in with an approved administrator account. There is no local-data or unauthenticated preview.</p>
      <p>Every call uses gpt-5-mini: at most 200 approved notes, 48,000 UTF-8 source bytes, 96,000 instruction/input bytes and 1,024 output tokens. One request, 30-second provider timeout, no automatic retries. Charges may apply even after timeout. Limits are not a fixed euro cost or an account-wide spending cap.</p>
      <button className="button button-surface" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Reload workspace</button>
      <p className="field-hint">Reloading discards unsaved edits and checks current sources.</p>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    {accessDenied && <Link href="/auth/sign-in" className="text-button">Sign in as an administrator</Link>}
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">Loading or saving area summary...</p>}
    {setup.state === "ready" && !accessDenied && <section className={styles.card}>
      <label className={styles.field}>Choose a reported location
        <select value={locationId} disabled={busy} onChange={(event) => {
          clearPrivate(); setError(null); setLocationId(event.target.value);
        }}>
          <option value="">Choose a location</option>
          {locations.map((location) => <option key={location.id} value={location.id}>
            {location.lat.toFixed(5)}, {location.lng.toFixed(5)} - {location.reportCount} approved reports
          </option>)}
        </select>
      </label>
      {!busy && locations.length === 0 && <p>No reported locations returned by the public locations API. Approve community reports before generating a summary.</p>}
      <p className="field-hint">The selected spot anchors an inclusive 500m radius, not chained neighbouring pins. The existing 100m map circle and risk score are unchanged.</p>
    </section>}
    {workspace && !accessDenied && <>
      <section className={styles.card}>
        <h2>Nearby source notes</h2>
        <p>{workspace.sourceCount} human-approved notes · {workspace.radiusMetres} m radius · {workspace.sourceBytes.toLocaleString()} UTF-8 bytes</p>
        {workspace.blockedReason && <p className="form-error" role="alert">{workspace.blockedReason}</p>}
        <div className={styles.actions}>
          <button className="button button-primary" disabled={busy || !!workspace.blockedReason}
            onClick={() => void act("generate")}>{workspace.draft ? "Use cached draft" : "Generate draft (may incur cost)"}</button>
          {(workspace.draft || workspace.published) && <button className="button button-surface" disabled={busy || !!workspace.blockedReason}
            onClick={() => void act("regenerate")}>Regenerate draft (paid request)</button>}
        </div>
        <p className="field-hint">Generation sends all approved note descriptions, not identities, photos or coordinates. Notes are untrusted data. No arbitrary subset is used. Repeated paid requests for this centre are limited to one per minute.</p>
        {workspace.notes.length > 0 && <details>
          <summary>Read all {workspace.notes.length} source notes before approval</summary>
          <ol className={styles.sources}>{workspace.notes.map((note, index) => <li key={index}>
            {note.description?.trim() ? note.description : "(Approved report with no note text)"}
          </li>)}</ol>
        </details>}
      </section>
      {workspace.draft && <section className={styles.card} aria-label="Draft review">
        <h2>Draft - not public</h2>
        <label className={styles.field}>One-sentence summary
          <textarea rows={3} maxLength={AREA_SUMMARY_MAX_SENTENCE_LENGTH} disabled={busy} value={sentence} onChange={(event) => {
            setSentence(event.target.value); setReviewed(false);
          }} />
        </label>
        <p className="field-hint">{summaryWordCount(sentence)}/{AREA_SUMMARY_MAX_WORDS} words · {sentence.length}/{AREA_SUMMARY_MAX_SENTENCE_LENGTH} characters. Start with &quot;Reports mention &quot;, end with one period, and use no other sentence punctuation. Attribute reports cautiously; never infer requirements or turn allegations into facts.</p>
        {!summarySentenceSchema.safeParse(sentence).success && <p role="alert">Use one valid short sentence without contact details, markup or extra sentences.</p>}
        <label className={styles.confirmation}><input type="checkbox" checked={reviewed} disabled={busy}
          onChange={(event) => setReviewed(event.target.checked)} />
          I reviewed this exact sentence against all source notes, removed identifying details and unsupported claims, and approve it for public display.
        </label>
        <div className={styles.actions}>
          <button className="button button-primary" disabled={busy || !reviewed || !summarySentenceSchema.safeParse(sentence).success}
            onClick={() => void act("approve")}>Approve &amp; publish summary</button>
          <button className="button button-surface" disabled={busy} onClick={() => void act("reject")}>Reject draft</button>
        </div>
      </section>}
      {workspace.published && <section className={styles.card} aria-label="Current published summary">
        <h2>Current published summary</h2><p>{workspace.published.sentence}</p>
        <p className="field-hint">{workspace.published.sourceCount} community notes, human-reviewed {formatDateTime(workspace.published.reviewedAt)}. Not a verified incident or legal requirement.</p>
      </section>}
    </>}
  </div>;
}

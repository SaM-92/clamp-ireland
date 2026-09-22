"use client";

import { useState } from "react";
import { z } from "zod";
import Link from "next/link";
import { DEMO_CASES, DEMO_NOTES, type DemoCase } from "../samples";
import styles from "./AiDemo.module.css";

const resultSchema = z.strictObject({
  source: z.enum(["azure", "local-rule"]), kind: z.enum(["summary", "policy"]),
  message: z.string().min(1).max(500), allowed: z.boolean().optional(),
  durationMs: z.number().nonnegative(), remaining: z.number().int().min(0).max(10), cached: z.boolean(),
});
type Result = z.infer<typeof resultSchema>;

export function AiDemo({ ready, setupMessage, remaining }: { ready: boolean; setupMessage: string; remaining: number }) {
  const [pending, setPending] = useState<DemoCase | null>(null);
  const [results, setResults] = useState<Partial<Record<DemoCase, Result>>>({});
  const [errors, setErrors] = useState<Partial<Record<DemoCase, string>>>({});
  const [budget, setBudget] = useState(remaining);

  async function run(id: DemoCase) {
    setPending(id);
    setErrors((previous) => ({ ...previous, [id]: undefined }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch("/api/dev/ai-demo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ example: id }), signal: controller.signal, cache: "no-store",
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const error = z.object({ error: z.string(), remaining: z.number().int().min(0).max(10).optional() }).safeParse(value);
        if (error.success && error.data.remaining !== undefined) setBudget(error.data.remaining);
        throw new Error(error.success ? error.data.error : "AI demo unavailable. No result was accepted.");
      }
      const result = resultSchema.parse(value);
      setResults((previous) => ({ ...previous, [id]: result }));
      setBudget(result.remaining);
    } catch (error) {
      setErrors((previous) => ({ ...previous, [id]: controller.signal.aborted
        ? "The request timed out. A model charge may still apply; nothing was published."
        : error instanceof Error ? error.message : "Could not run the local demonstration." }));
    } finally {
      clearTimeout(timer);
      setPending(null);
    }
  }

  return <main id="main-content" className={styles.page}>
    <Link href="/" className="text-button">Back to the community map</Link>
    <header className={styles.header}>
      <p className="eyebrow">Development only / synthetic examples</p>
      <h1>See the AI work.</h1>
      <p>Real Azure GPT-5 mini calls, not prewritten AI answers. Nothing here creates a report, unlocks administration or publishes a summary.</p>
      <p className={styles.budget}>{budget} of 10 model requests remaining. Repeated successful examples use a local cache.</p>
      {!ready && <p className="form-error" role="alert">{setupMessage}</p>}
    </header>
    <div className={styles.grid}>
      {(Object.entries(DEMO_CASES) as [DemoCase, typeof DEMO_CASES[DemoCase]][]).map(([id, example]) => {
        const result = results[id];
        return <section className={styles.card} key={id} aria-labelledby={`${id}-title`} aria-busy={pending === id}>
          <h2 id={`${id}-title`}>{example.title}</h2>
          {id === "summary" ? <ol className={styles.notes}>{DEMO_NOTES.map((note) => <li key={note}>{note}</li>)}</ol>
            : <blockquote className={styles.example}>{example.text}</blockquote>}
          <button className="button button-primary" disabled={!ready || pending !== null || (budget === 0 && !result)}
            onClick={() => void run(id)}>
            {pending === id ? "Checking..." : id === "summary" ? "Generate a real summary" : "Check this example"}
          </button>
          {pending === id && <p role="status">Processing this synthetic example. No automatic retries.</p>}
          {errors[id] && <p className="form-error" role="alert">{errors[id]}</p>}
          {result && !errors[id] && <div className={styles.result} role="status">
            <p className="eyebrow">{result.source === "azure" ? "Real Azure response" : "Local policy rule / no model call"}</p>
            {result.kind === "policy" && <strong>{result.allowed ? "Allowed" : "Blocked by content policy"}</strong>}
            <p>{result.message}</p>
            <small>{(result.durationMs / 1000).toFixed(1)} s{result.cached ? " / cached result" : ""}{result.kind === "summary" ? " / draft, not human-approved" : ""}</small>
          </div>}
        </section>;
      })}
    </div>
    <p className={styles.footnote}>The summary uses synthetic notes, not a live 500 m database query. Production summaries still require approved sources and a separate human review. Moderation can make mistakes; a model pass never publishes content automatically.</p>
  </main>;
}

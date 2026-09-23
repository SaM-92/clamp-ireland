"use client";

import { useEffect, useRef, useState } from "react";
import { DONATION_URL } from "../config";
import { Icon } from "@/lib/components/Icon";
import { env } from "@/lib/env";

const PRESETS_EUR = [3, 5, 10, 20];
const stripeReady = Boolean(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

export function DonateButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  if (!stripeReady) {
    if (!DONATION_URL) {
      return <span className={`support-placeholder ${className}`} title="Support link coming soon">
        <Icon name="heart" /> <span>Support us <span className="support-soon">soon</span></span>
      </span>;
    }
    return (
      <a href={DONATION_URL} target="_blank" rel="noopener noreferrer" className={`button button-support support-cta ${className}`}>
        <Icon name="heart" className="support-heart" /> <span>Buy us a coffee</span>
      </a>
    );
  }

  return (
    <>
      <button type="button" className={`button button-support support-cta ${className}`} onClick={() => setOpen(true)}>
        <Icon name="heart" className="support-heart" /> <span>Buy us a coffee</span>
      </button>
      {open && <SupportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SupportDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState<number>(5);
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const chosen = custom.trim() ? Number(custom) : amount;

  async function checkout() {
    if (!Number.isFinite(chosen) || chosen < 1 || chosen > 500) {
      setError("Choose an amount between \u20ac1 and \u20ac500.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/support/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: chosen }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.url !== "string") throw new Error(data.error ?? "Could not start checkout.");
      window.location.href = data.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start checkout.");
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialog} className="report-dialog support-dialog" aria-labelledby="support-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="dialog-heading">
        <div>
          <p className="eyebrow"><Icon name="heart" width="14" height="14" /> Community-funded, no ads</p>
          <h2 id="support-title">Chip in for clamptracker.ie</h2>
        </div>
        <button className="icon-button" aria-label="Close support dialog" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="report-form">
        <p className="field-hint">
          Every euro covers hosting and free map tiles so the map stays free, ad-free and community-run.
        </p>
        <div className="support-presets" role="group" aria-label="Choose an amount">
          {PRESETS_EUR.map((value) => (
            <button
              key={value}
              type="button"
              className={`support-preset ${!custom && amount === value ? "support-preset-active" : ""}`}
              onClick={() => { setAmount(value); setCustom(""); }}
            >
              &euro;{value}
            </button>
          ))}
          <label className="support-custom">
            &euro;
            <input
              type="number"
              min={1}
              max={500}
              placeholder="Other"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
            />
          </label>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="button" className="button button-primary support-checkout" onClick={() => void checkout()} disabled={submitting}>
          {submitting ? "Redirecting to secure checkout…" : `Continue to secure checkout \u2022 \u20ac${Number.isFinite(chosen) ? chosen : 0}`}
        </button>
        <p className="field-hint">Handled by Stripe. Card details never reach clamptracker.ie.</p>
      </div>
    </dialog>
  );
}

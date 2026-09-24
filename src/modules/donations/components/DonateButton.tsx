"use client";

import { useEffect, useRef, useState } from "react";
import { DONATION_URL } from "../config";
import { Icon } from "@/lib/components/Icon";
import { env } from "@/lib/env";

// Stripe approved one product for review: a €5 "coffee", buyable 1-99 at a
// time - so every amount here is really a quantity of that fixed-price item.
const COFFEE_PRICE_EUR = 5;
const MAX_COFFEES = 99;
const PRESET_COFFEES = [1, 2, 4, 10];
const stripeReady = env.NEXT_PUBLIC_SUPPORT_ENABLED && Boolean(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

export function DonateButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  // Hidden entirely (not even a placeholder) until a maintainer turns
  // NEXT_PUBLIC_SUPPORT_ENABLED on - Stripe review/business verification can
  // still be pending even with test keys configured.
  if (!env.NEXT_PUBLIC_SUPPORT_ENABLED) return null;

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
  const [coffees, setCoffees] = useState<number>(1);
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const chosenCoffees = custom.trim() ? Number(custom) : coffees;
  const chosenEur = chosenCoffees * COFFEE_PRICE_EUR;

  async function checkout() {
    if (!Number.isInteger(chosenCoffees) || chosenCoffees < 1 || chosenCoffees > MAX_COFFEES) {
      setError(`Choose between 1 and ${MAX_COFFEES} coffees (\u20ac${COFFEE_PRICE_EUR} each).`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/support/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: chosenEur }),
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
          <h2 id="support-title">Buy us a coffee</h2>
        </div>
        <button className="icon-button" aria-label="Close support dialog" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="report-form">
        <p className="field-hint">
          Each coffee is &euro;{COFFEE_PRICE_EUR} and covers hosting and free map tiles so the map stays free, ad-free and community-run.
        </p>
        <div className="support-presets" role="group" aria-label="Choose how many coffees">
          {PRESET_COFFEES.map((value) => (
            <button
              key={value}
              type="button"
              className={`support-preset ${!custom && coffees === value ? "support-preset-active" : ""}`}
              onClick={() => { setCoffees(value); setCustom(""); }}
            >
              &euro;{value * COFFEE_PRICE_EUR}
            </button>
          ))}
          <label className="support-custom">
            <input
              type="number"
              min={1}
              max={MAX_COFFEES}
              step={1}
              placeholder="Other"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
            />
            coffees
          </label>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="button" className="button button-primary support-checkout" onClick={() => void checkout()} disabled={submitting}>
          {submitting ? "Redirecting to secure checkout…" : `Continue to secure checkout \u2022 \u20ac${Number.isFinite(chosenEur) ? chosenEur : 0}`}
        </button>
        <p className="field-hint">Handled by Stripe. Card details never reach clamptracker.ie.</p>
      </div>
    </dialog>
  );
}


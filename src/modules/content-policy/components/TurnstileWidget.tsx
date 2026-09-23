"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/**
 * Cloudflare Turnstile widget used to bot-check the anonymous ("no account
 * needed") report path. Loads the Cloudflare script once per page and
 * reports the resulting token (or "" once it expires) to the caller.
 */
export function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    function render() {
      if (cancelled || widgetId.current || !containerRef.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => { setError(true); return false; },
      });
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    script.addEventListener("error", () => setError(true));
    render();
    return () => {
      cancelled = true;
      script?.removeEventListener("load", render);
      // Cloudflare logs a harmless console warning if the widget/container was
      // already torn down (e.g. React dev-mode's double-invoked effects) - it's
      // not user-facing, but swallow it so cleanup never throws either way.
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* already removed */ }
      }
      // Must clear the ref even on a no-op removal: otherwise the next mount's
      // render() sees a stale non-null id and silently skips re-rendering,
      // leaving the widget container permanently empty (dev Strict Mode
      // double-invokes this effect, so this path runs on every real mount too).
      widgetId.current = null;
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return (
    <div className="field turnstile-field">
      <div ref={containerRef} />
      {error && <span className="form-error" role="alert">The bot check could not load. Check your connection and reload the page.</span>}
    </div>
  );
}

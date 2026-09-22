import { collectionResultSchema, type TrafficEvent } from "../types";

export function viewportCategory(matchMedia: (query: string) => { matches: boolean }): TrafficEvent["viewport"] {
  if (matchMedia("(max-width: 760px)").matches) return "mobile";
  if (matchMedia("(max-width: 1000px)").matches) return "tablet";
  return "desktop";
}

export async function sendPageview(event: TrafficEvent): Promise<"recorded" | "disabled" | "failed"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("/api/analytics/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route: event.route, viewport: event.viewport }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      keepalive: true,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Traffic collection rejected.");
    const result = collectionResultSchema.parse(await response.json());
    return result.enabled ? "recorded" : "disabled";
  } catch {
    // No automatic retry: the server may have counted a request whose response was lost.
    console.warn("[Traffic] pageview was not confirmed; no retry attempted.");
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
}

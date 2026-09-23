// Shared date/time display formatting. Uses the Irish/European dd/mm/yyyy
// convention explicitly (en-IE), rather than relying on the browser's
// default locale, which for many users renders American mm/dd/yyyy.
const DATE_LOCALE = "en-IE";
const DUBLIN_TIME_ZONE = "Europe/Dublin";

/**
 * Today's date (YYYY-MM-DD) in Irish local time. Never use the server's or
 * browser's own UTC/local "today" for this - during Irish Summer Time
 * (UTC+1) a naive UTC "today" can be a day behind Dublin's actual date,
 * which would wrongly reject a same-day incident report entered late in the
 * evening. en-CA formats as YYYY-MM-DD directly, so no reformatting is needed.
 */
export function todayInDublin(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DUBLIN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(DATE_LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(DATE_LOCALE, {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

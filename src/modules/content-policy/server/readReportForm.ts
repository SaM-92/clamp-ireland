import "server-only";
import { setTimeout, clearTimeout } from "node:timers";
import { PHOTO_LIMITS } from "@/modules/photos/policy";

export const MAX_REPORT_BYTES = PHOTO_LIMITS.sourceBytes + 1024 * 1024;

/** Content-Length is optional and untrusted, so enforce the cap while reading too. */
export async function readReportForm(request: Request): Promise<FormData> {
  if (!request.body || Number(request.headers.get("content-length")) > MAX_REPORT_BYTES) throw new Error("Invalid form");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => console.error("[Reports] upload stream cancellation failed"));
  }, 120_000);
  try {
    while (true) {
      const part = await reader.read();
      if (timedOut) throw new Error("Report upload timed out");
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_REPORT_BYTES) {
        await reader.cancel();
        throw new Error("Report too large");
      }
      chunks.push(new Uint8Array(part.value));
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  return new Response(new Blob(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") ?? "" },
  }).formData();
}

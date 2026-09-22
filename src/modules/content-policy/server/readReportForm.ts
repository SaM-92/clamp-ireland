import "server-only";

const MAX_REPORT_BYTES = 9 * 1024 * 1024;

/** Content-Length is optional and untrusted, so enforce the cap while reading too. */
export async function readReportForm(request: Request): Promise<FormData> {
  if (!request.body || Number(request.headers.get("content-length")) > MAX_REPORT_BYTES) throw new Error("Invalid form");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_REPORT_BYTES) {
        await reader.cancel();
        throw new Error("Report too large");
      }
      chunks.push(new Uint8Array(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(new Blob(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") ?? "" },
  }).formData();
}

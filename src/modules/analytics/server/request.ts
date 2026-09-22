import "server-only";
import { trafficEventSchema, type TrafficEvent } from "../types";

export const MAX_TRAFFIC_BODY_BYTES = 256;

export class TrafficRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function readTrafficEvent(request: Request): Promise<TrafficEvent> {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== new URL(request.url).origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new TrafficRequestError("Same-origin traffic requests only.", 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new TrafficRequestError("Use application/json.", 415);
  }
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) {
    throw new TrafficRequestError("Invalid content length.", 400);
  }
  if (length !== null && Number(length) > MAX_TRAFFIC_BODY_BYTES) {
    throw new TrafficRequestError("Traffic payload is too large.", 413);
  }
  if (!request.body) throw new TrafficRequestError("Traffic payload is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_TRAFFIC_BODY_BYTES) {
        void reader.cancel().catch(() => console.warn("[Traffic] oversized request cancellation failed"));
        throw new TrafficRequestError("Traffic payload is too large.", 413);
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof TrafficRequestError) throw error;
    throw new TrafficRequestError("Could not read traffic payload.", 400);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new TrafficRequestError("Invalid JSON traffic payload.", 400); }
  const result = trafficEventSchema.safeParse(value);
  if (!result.success) throw new TrafficRequestError("Only an allowed route and viewport category are accepted.", 400);
  return result.data;
}

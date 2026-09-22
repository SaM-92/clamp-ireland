import "server-only";
import { AreaSummaryError } from "./errors";

export async function readBoundedJson(
  input: Pick<Response, "body">, maxBytes: number, error: AreaSummaryError,
): Promise<unknown> {
  if (!input.body) throw error;
  const reader = input.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw error;
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch {
    throw error;
  } finally {
    reader.releaseLock();
  }
}

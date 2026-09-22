import "server-only";
import { Worker } from "node:worker_threads";
import { setTimeout, clearTimeout } from "node:timers";
import path from "node:path";
import { PHOTO_LIMITS, PhotoError, validatePhoto } from "../policy";

let processing = false;
const messages: Record<string, string> = {
  pixels: "The photo exceeds 64 megapixels. Export a smaller version.",
  frames: "Choose a single still photo, not an animated or multi-image file.",
  format: "The file is not a supported JPEG, PNG, WebP or HEIC/HEIF photo.",
  output: "The photo could not be compressed within 3 MiB. Export a smaller version.",
  decode: "The photo could not be decoded safely. Export it as JPEG and try again.",
};

export async function normalizePhoto(file: File): Promise<Uint8Array> {
  validatePhoto(file);
  if (processing) throw new PhotoError("photo_busy", "Another photo is processing. Please try again shortly.", 429);
  processing = true;
  let worker: Worker | undefined;
  try {
    const bytes = await file.arrayBuffer();
    return await new Promise<Uint8Array>((resolve, reject) => {
      worker = new Worker(path.join(process.cwd(), "src", "modules", "photos", "server", "normalize-worker.mjs"), {
        workerData: { bytes, limits: PHOTO_LIMITS }, transferList: [bytes],
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      let settled = false;
      const finish = (error?: PhotoError, result?: Uint8Array) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (result) resolve(result);
      };
      const timer = setTimeout(() => finish(new PhotoError("photo_unavailable", "Photo processing timed out. Nothing was uploaded.", 503)), PHOTO_LIMITS.processingMs);
      worker.once("error", () => {
        console.error("[Photos] processing worker failed");
        finish(new PhotoError("photo_unavailable", "Photo processing is unavailable. Nothing was uploaded.", 503));
      });
      worker.once("exit", () => {
        if (!settled) finish(new PhotoError("photo_unavailable", "Photo processing stopped unexpectedly. Nothing was uploaded.", 503));
      });
      worker.once("message", (value: unknown) => {
        if (value && typeof value === "object" && "ok" in value) {
          if (value.ok === true && "bytes" in value && value.bytes instanceof Uint8Array
            && value.bytes.byteLength > 0 && value.bytes.byteLength <= PHOTO_LIMITS.storedBytes) {
            finish(undefined, value.bytes);
            return;
          }
          if (value.ok === false && "reason" in value && typeof value.reason === "string" && Object.hasOwn(messages, value.reason)) {
            finish(new PhotoError("invalid_photo", messages[value.reason], 422));
            return;
          }
        }
        finish(new PhotoError("photo_unavailable", "Photo processing returned an invalid result. Nothing was uploaded.", 503));
      });
    });
  } finally {
    if (worker) await worker.terminate();
    processing = false;
  }
}

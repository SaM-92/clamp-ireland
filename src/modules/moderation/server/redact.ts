import "server-only";
import sharp from "sharp";
import { PHOTO_LIMITS } from "@/modules/photos/policy";
import type { RedactionRegion } from "../types";

const BLUR_SIGMA = 30;

function toPixelRect(region: RedactionRegion, width: number, height: number) {
  const left = Math.min(width - 1, Math.max(0, Math.round(region.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(region.y * height)));
  const w = Math.min(width - left, Math.max(1, Math.round(region.width * width)));
  const h = Math.min(height - top, Math.max(1, Math.round(region.height * height)));
  return { left, top, width: w, height: h };
}

/**
 * Applies moderator-drawn blur/black-box rectangles to an already-normalized
 * (small, already-validated) webp photo and re-encodes it, under the same
 * stored-size budget as a fresh upload. Only ever called on a photo a human
 * moderator has decided to publish - this hides specific identifying details
 * (faces, plates, house numbers) rather than replacing the manual review
 * itself. See docs/04-legal-considerations.md.
 */
export async function redactImage(original: Uint8Array, regions: RedactionRegion[]): Promise<Uint8Array> {
  const base = sharp(Buffer.from(original), { limitInputPixels: PHOTO_LIMITS.pixels });
  const metadata = await base.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("Could not read photo dimensions for redaction.");

  const overlays = await Promise.all(regions.map(async (region) => {
    const rect = toPixelRect(region, width, height);
    const input = region.mode === "blackout"
      ? await sharp({
        create: { width: rect.width, height: rect.height, channels: 3, background: { r: 0, g: 0, b: 0 } },
      }).png().toBuffer()
      : await base.clone().extract(rect).blur(BLUR_SIGMA).png().toBuffer();
    return { input, left: rect.left, top: rect.top };
  }));

  for (const quality of [82, 68, 50]) {
    const candidate = await base.clone().composite(overlays).webp({ quality, effort: 4 }).toBuffer();
    if (candidate.length <= PHOTO_LIMITS.storedBytes) return new Uint8Array(candidate);
  }
  throw new Error("The redacted photo could not be compressed within the stored size limit.");
}

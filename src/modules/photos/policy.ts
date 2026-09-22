export const PHOTO_LIMITS = {
  sourceBytes: 50 * 1024 * 1024,
  pixels: 64_000_000,
  storedBytes: 3 * 1024 * 1024,
  maxDimension: 4096,
  processingMs: 30_000,
} as const;

export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
export const PHOTO_HINT = "JPEG, PNG, WebP or HEIC/HEIF, up to 50 MiB and 64 megapixels. RAW/DNG is not supported. We remove metadata and compress stored photos to at most 3 MiB.";

export class PhotoError extends Error {
  constructor(public readonly code: "invalid_photo" | "photo_busy" | "photo_unavailable",
    message: string, public readonly status: 400 | 413 | 422 | 429 | 503) {
    super(message);
    this.name = "PhotoError";
  }
}

export function validatePhoto(file: File): void {
  if (file.size === 0 || file.size > PHOTO_LIMITS.sourceBytes) {
    throw new PhotoError("invalid_photo", "Choose a non-empty photo up to 50 MiB.", 413);
  }
  const type = file.type.toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(type)
    && !(type === "" && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))) {
    throw new PhotoError("invalid_photo", "Choose a JPEG, PNG, WebP or HEIC/HEIF photo. Export RAW/DNG as JPEG first.", 400);
  }
}

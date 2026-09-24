import { z } from "zod";

// A moderator-drawn rectangle over a pending photo, as a fraction (0..1) of
// the full image's width/height - resolution-independent, so the browser
// only ever needs the rendered <img>'s own bounding box, never its natural
// pixel size. "blackout" fully hides the region; "blur" heavily obscures it
// while keeping some visual context. See src/modules/moderation/server/redact.ts.
export const redactionRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  mode: z.enum(["blur", "blackout"]),
});
export const redactionRegionsSchema = z.array(redactionRegionSchema).min(1).max(20);
export type RedactionRegion = z.infer<typeof redactionRegionSchema>;

export const pendingReportsSchema = z.array(z.object({
  id: z.string().uuid(),
  locationId: z.string().uuid(),
  reporterType: z.enum(["victim", "neighbour", "witness"]),
  description: z.string(),
  imageUrl: z.url().nullable(),
  hasImage: z.boolean(),
  imageError: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  isAnonymous: z.boolean(),
  // true when the AI risk check flagged this text for review (always false for photo-only holds).
  isFlagged: z.boolean(),
}));

export type PendingReport = z.infer<typeof pendingReportsSchema>[number];

export const publishedReportsSchema = z.array(z.object({
  id: z.string().uuid(),
  locationId: z.string().uuid(),
  reporterType: z.enum(["victim", "neighbour", "witness"]),
  description: z.string(),
  hasImage: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  reviewedAt: z.iso.datetime({ offset: true }),
  isAnonymous: z.boolean(),
  // true when auto-published by the AI risk check rather than a human moderator (reviewed_by IS NULL).
  autoPublished: z.boolean(),
}));

export type PublishedReport = z.infer<typeof publishedReportsSchema>[number];

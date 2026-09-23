import { z } from "zod";

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

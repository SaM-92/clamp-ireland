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
}));

export type PendingReport = z.infer<typeof pendingReportsSchema>[number];

import { z } from "zod";

const count = z.number().int().nonnegative();

export const adminOverviewSchema = z.object({
  pending: count,
  published: count,
  rejected: count,
  totalReports: count,
  totalUsers: count,
  autoPublished: count,
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

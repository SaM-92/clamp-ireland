import { z } from "zod";

export const trafficEventSchema = z.strictObject({
  route: z.enum(["/", "/appeal"]),
  viewport: z.enum(["mobile", "tablet", "desktop"]),
});
export type TrafficEvent = z.infer<typeof trafficEventSchema>;

const count = z.number().int().nonnegative().safe();
export const trafficSummarySchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false), reason: z.literal("Analytics not enabled") }),
  z.object({
    enabled: z.literal(true),
    from: z.iso.date(),
    through: z.iso.date(),
    totalPageviews: count,
    mobilePageviews: count,
    days: z.array(z.object({
      day: z.iso.date(),
      pageviews: count,
      mobilePageviews: count,
    })).max(30),
  }),
]);
export type TrafficSummary = z.infer<typeof trafficSummarySchema>;

export const collectionResultSchema = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false), reason: z.literal("Analytics not enabled") }),
  z.strictObject({ enabled: z.literal(true), recorded: z.literal(true) }),
]);

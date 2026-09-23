import "server-only";
import { env, isDatabaseConfigured } from "@/lib/env";
import { trafficCollectionAllowed } from "../lib/policy";

export function isTrafficEnabled() {
  return trafficCollectionAllowed({
    enabled: env.ENABLE_TRAFFIC_ANALYTICS,
    nodeEnv: process.env.NODE_ENV,
    databaseConfigured: isDatabaseConfigured,
    vercelEnv: env.VERCEL_ENV,
  });
}

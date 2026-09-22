import "server-only";
import { env, isSupabaseConfigured } from "@/lib/env";
import { trafficCollectionAllowed } from "../lib/policy";

export function isTrafficEnabled() {
  return trafficCollectionAllowed({
    enabled: env.ENABLE_TRAFFIC_ANALYTICS,
    nodeEnv: process.env.NODE_ENV,
    supabaseConfigured: isSupabaseConfigured,
    serviceRoleConfigured: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    vercelEnv: env.VERCEL_ENV,
  });
}

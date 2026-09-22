import { env } from "@/lib/env";
import { createSeoPolicy } from "./policy";

export const seoPolicy = createSeoPolicy({
  siteUrl: env.SITE_URL,
  allowIndexing: env.ALLOW_INDEXING,
  runtime: process.env.NODE_ENV,
  vercelEnv: env.VERCEL_ENV,
});

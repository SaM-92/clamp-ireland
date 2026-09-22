/**
 * Central place to read environment variables. Every other module should
 * import from here instead of touching `process.env` directly, so there is
 * one place to see (and update) what the app actually needs to run.
 */
export const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  NEXT_PUBLIC_MAP_TILE_STYLE_URL:
    process.env.NEXT_PUBLIC_MAP_TILE_STYLE_URL ??
    "https://tiles.openfreemap.org/styles/bright",
  NEXT_PUBLIC_DONATION_URL:
    process.env.NEXT_PUBLIC_DONATION_URL ?? "",
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
  NEXT_PUBLIC_REGISTRATION_ENABLED: process.env.NEXT_PUBLIC_REGISTRATION_ENABLED === "true",
  SITE_URL: process.env.SITE_URL ?? "",
  ALLOW_INDEXING: process.env.ALLOW_INDEXING === "true",
  VERCEL_ENV: process.env.VERCEL_ENV,
  ENABLE_TRAFFIC_ANALYTICS: process.env.ENABLE_TRAFFIC_ANALYTICS === "true",
  ENABLE_AREA_SUMMARIES: process.env.ENABLE_AREA_SUMMARIES === "true",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  AI_PROVIDER: process.env.AI_PROVIDER ?? "openai",
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT ?? "",
  AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5-mini",
  AZURE_OPENAI_AUTH_MODE: process.env.AZURE_OPENAI_AUTH_MODE ?? "entra",
  AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY ?? "",
  AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID ?? "",
  AZURE_STORAGE_ACCOUNT_NAME: process.env.AZURE_STORAGE_ACCOUNT_NAME ?? "",
  AZURE_STORAGE_AUTH_MODE: process.env.AZURE_STORAGE_AUTH_MODE ?? "managed-identity",
  ENABLE_LOCAL_AI_DEMO: process.env.ENABLE_LOCAL_AI_DEMO === "true",
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_ALLOWED_USER_IDS: process.env.ADMIN_ALLOWED_USER_IDS ?? "",
  ADMIN_SITE_URL: process.env.ADMIN_SITE_URL ?? "",
} as const;

export const isSupabaseConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

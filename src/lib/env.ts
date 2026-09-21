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
    "https://tiles.openfreemap.org/styles/liberty",
  NEXT_PUBLIC_DONATION_URL:
    process.env.NEXT_PUBLIC_DONATION_URL ??
    "https://www.buymeacoffee.com/clampireland",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
} as const;

export const isSupabaseConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

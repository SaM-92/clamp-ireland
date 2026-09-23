/**
 * Central place to read environment variables. Every other module should
 * import from here instead of touching `process.env` directly, so there is
 * one place to see (and update) what the app actually needs to run.
 */
export const env = {
  AZURE_SQL_SERVER: process.env.AZURE_SQL_SERVER ?? "",
  AZURE_SQL_DATABASE: process.env.AZURE_SQL_DATABASE ?? "",
  // "entra" (default) uses DefaultAzureCredential-style managed identity/az-cli
  // auth against the real, Entra-only Azure SQL server - see
  // infra/preflight/sql.bicep. "sql" is refused outright against any
  // *.database.windows.net hostname; it exists only for a local/CI SQL Server
  // container during development and testing.
  AZURE_SQL_AUTH_MODE: process.env.AZURE_SQL_AUTH_MODE ?? "entra",
  AZURE_SQL_USER: process.env.AZURE_SQL_USER ?? "",
  AZURE_SQL_PASSWORD: process.env.AZURE_SQL_PASSWORD ?? "",
  // 1433 in production; overridable so a local/CI SQL Server test container
  // can be mapped to a non-standard host port alongside other local services.
  AZURE_SQL_PORT: Number(process.env.AZURE_SQL_PORT ?? 1433),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
  AUTH_PUBLIC_ORIGIN: process.env.AUTH_PUBLIC_ORIGIN ?? "",
  AUTH_ALLOWED_EMAILS: process.env.AUTH_ALLOWED_EMAILS ?? "",
  ALLOW_PUBLIC_SIGNUP: process.env.ALLOW_PUBLIC_SIGNUP === "true",
  NEXT_PUBLIC_MAP_TILE_STYLE_URL:
    process.env.NEXT_PUBLIC_MAP_TILE_STYLE_URL ??
    "https://tiles.openfreemap.org/styles/bright",
  NEXT_PUBLIC_DONATION_URL:
    process.env.NEXT_PUBLIC_DONATION_URL ?? "",
  // Stripe powers the "Support us" checkout. The secret key is server-only,
  // used to create hosted Checkout Sessions - card details never reach this
  // app. The publishable key is not secret; its presence also tells the
  // client whether to offer the interactive Stripe flow at all (same pattern
  // as NEXT_PUBLIC_TURNSTILE_SITE_KEY below). See docs/10-support-payments.md.
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
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
  // Cloudflare Turnstile protects the anonymous ("no account needed") report
  // path from bots. The site key is not secret (it's embedded in the page);
  // the secret key must never reach the browser.
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? "",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
} as const;

export const isDatabaseConfigured = Boolean(env.AZURE_SQL_SERVER && env.AZURE_SQL_DATABASE);

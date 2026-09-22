export const disabledAiEnvironment = Object.freeze({
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "",
  ENABLE_LOCAL_AI_DEMO: "false",
  AZURE_OPENAI_ENDPOINT: "",
  AZURE_OPENAI_DEPLOYMENT: "",
  AZURE_OPENAI_AUTH_MODE: "",
  AZURE_OPENAI_API_KEY: "",
  AZURE_CLIENT_ID: "",
  AZURE_STORAGE_ACCOUNT_NAME: "",
  AZURE_STORAGE_AUTH_MODE: "managed-identity",
  AZURE_TENANT_ID: "",
  AZURE_CLIENT_SECRET: "",
  AZURE_FEDERATED_TOKEN_FILE: "",
  AZURE_CLIENT_CERTIFICATE_PATH: "",
  AZURE_CLIENT_CERTIFICATE_PASSWORD: "",
  IDENTITY_ENDPOINT: "",
  IDENTITY_HEADER: "",
  MSI_ENDPOINT: "",
  MSI_SECRET: "",
});

export function syntheticEnvironment(source = process.env) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|TEMP|TMP|TMPDIR|LOCALAPPDATA|APPDATA|LANG|LC_ALL|CI|TERM|FORCE_COLOR|PLAYWRIGHT_BROWSERS_PATH)$/i;
  const clean = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key)));
  return {
    ...clean,
    ...disabledAiEnvironment,
    NEXT_TELEMETRY_DISABLED: "1",
    SUPABASE_SERVICE_ROLE_KEY: "",
    ADMIN_ALLOWED_USER_IDS: "",
    ADMIN_SITE_URL: "",
    ENABLE_AREA_SUMMARIES: "false",
    ENABLE_TRAFFIC_ANALYTICS: "false",
    SITE_URL: "",
    ALLOW_INDEXING: "false",
    NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: "false",
    NEXT_PUBLIC_REGISTRATION_ENABLED: "false",
    NEXT_PUBLIC_DONATION_URL: "",
    APP_RELEASE_SHA: source.APP_RELEASE_SHA || "local",
    RELEASE_BUILD: source.RELEASE_BUILD === "true" ? "true" : "false",
  };
}

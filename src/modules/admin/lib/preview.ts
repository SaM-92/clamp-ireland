export function isAdminPreviewEnabled(nodeEnv: string | undefined, supabaseConfigured: boolean) {
  return nodeEnv === "development" && !supabaseConfigured;
}

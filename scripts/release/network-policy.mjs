export function requireNetworkIsolationReady() {
  throw new Error(
    "Deployment blocked: all-endpoint IP isolation is incomplete. Hosted Supabase HTTPS APIs are not covered by its database IP restrictions. Resolve the private backend and network design before enabling cloud deployment."
  );
}

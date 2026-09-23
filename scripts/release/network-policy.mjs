export function requireNetworkIsolationReady() {
  throw new Error(
    "Deployment blocked: all-endpoint IP isolation is incomplete and a durable single-host SQLite deployment is not approved. The old Container Apps topology is retired. Approve persistent local storage, hosting cost and private Blob connectivity before enabling cloud deployment."
  );
}

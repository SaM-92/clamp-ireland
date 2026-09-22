export type ReleaseMetadata = Readonly<{ version: string; sha: string }>;

export function releaseMetadata(
  version = process.env.APP_RELEASE_VERSION ?? "0.0.0",
  sha = process.env.APP_RELEASE_SHA ?? "local",
): ReleaseMetadata {
  if (version !== version.trim() || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      !(sha === "local" || (sha.length === 40 && /^[a-f0-9]{40}$/.test(sha)))) {
    throw new Error("Invalid build release metadata.");
  }
  // These two constants are replaced by Next at build time, not runtime settings.
  return Object.freeze({ version, sha });
}

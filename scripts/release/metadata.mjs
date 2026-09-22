import { readFileSync } from "node:fs";

export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const shaPattern = /^[a-f0-9]{40}$/;

export function validateRelease(version, sha, tag = `v${version}`) {
  if (version !== version.trim() || !versionPattern.test(version) || tag !== `v${version}`) {
    throw new Error("Release tag must be vX.Y.Z and match package.json version.");
  }
  if (sha.length !== 40 || !shaPattern.test(sha)) throw new Error("Release requires a full lowercase commit SHA.");
  return { version, sha, tag };
}

export function buildReleaseEnvironment(source = process.env) {
  const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  if (!versionPattern.test(version)) throw new Error("Package version must be X.Y.Z.");
  const sha = source.APP_RELEASE_SHA || "local";
  if (source.RELEASE_BUILD === "true" || sha !== "local") validateRelease(version, sha);
  return { APP_RELEASE_VERSION: version, APP_RELEASE_SHA: sha };
}

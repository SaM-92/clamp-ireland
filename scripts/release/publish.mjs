import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { validateRelease } from "./metadata.mjs";
import { imageReference } from "./deployment.mjs";

const source = process.env;
const release = validateRelease(source.RELEASE_VERSION, source.RELEASE_SHA, source.RELEASE_TAG);
const repository = source.GITHUB_REPOSITORY.toLowerCase();
const images = Object.fromEntries(["public", "admin"].map((app) =>
  [app, imageReference(repository, source[`${app.toUpperCase()}_DIGEST`], app)]));
const manifest = {
  schemaVersion: 1, ...release, images, containerSmoke: "passed",
  runId: source.GITHUB_RUN_ID, attempt: source.GITHUB_RUN_ATTEMPT,
  deployment: "not-claimed",
};
const directory = "test-results";
mkdirSync(directory, { recursive: true });
const file = `${directory}/release-${source.GITHUB_RUN_ID}-${source.GITHUB_RUN_ATTEMPT}.json`;
writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let existing = false;
try { gh("release", "view", release.tag, "--json", "id"); existing = true; }
catch {
  // Creating the release still fails explicitly if this was an API/permission error.
  gh("release", "create", release.tag, "--verify-tag", "--title", release.tag, "--generate-notes",
    "--notes", "Independent public/admin images passed read-only container smoke. This release does not claim deployment. Immutable images and run details are in the attached manifest.");
}
gh("release", "upload", release.tag, file);
console.log(existing ? "Added this attempt's immutable release manifest." : "Created versioned release and immutable manifest.");

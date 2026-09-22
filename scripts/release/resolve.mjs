import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { validateRelease, versionPattern } from "./metadata.mjs";

const tag = process.argv[2];
if (!tag?.startsWith("v") || !versionPattern.test(tag.slice(1)) || tag !== tag.trim()) {
  throw new Error("Expected release tag vX.Y.Z.");
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sha = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
git("merge-base", "--is-ancestor", sha, "origin/master");
const { version } = JSON.parse(git("show", `${sha}:package.json`));
const release = validateRelease(version, sha, tag);
if (!process.env.GITHUB_OUTPUT) throw new Error("GitHub output file missing.");
appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(release).map(([key, value]) => `${key}=${value}\n`).join(""));
console.log(`Validated ${tag} at ${sha}, on master history.`);

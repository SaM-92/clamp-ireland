import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { shaPattern, versionPattern, validateRelease } from "./metadata.mjs";

const validDigest = (value) => /^sha256:[a-f0-9]{64}$/.test(value ?? "") && value.length === 71 ? value : null;
const validSha = (value) => typeof value === "string" && value.length === 40 && shaPattern.test(value) ? value : null;
const numericId = (value) => typeof value === "string" && /^[1-9]\d{0,19}$/.test(value) && value.trim() === value ? value : null;
const jobResult = (value) => ["success", "failure", "cancelled", "skipped"].includes(value) ? value : "unknown";

function smokeResult(value) {
  const result = { outcome: ["passed", "failed", "not-run"].includes(value?.outcome) ? value.outcome : "unknown" };
  if (Number.isInteger(value?.attempts) && value.attempts >= 1 && value.attempts <= 12) result.attempts = value.attempts;
  return result;
}

export function createAttemptRecord(source, deploy = null) {
  const environment = ["production", "development"].includes(source.DEPLOY_ENVIRONMENT ?? "production")
    ? source.DEPLOY_ENVIRONMENT ?? "production" : null;
  const version = typeof source.RELEASE_VERSION === "string" && source.RELEASE_VERSION.trim() === source.RELEASE_VERSION &&
    versionPattern.test(source.RELEASE_VERSION) ? source.RELEASE_VERSION : null;
  const sha = validSha(source.RELEASE_SHA);
  const tag = version && source.RELEASE_TAG === `v${version}` ? source.RELEASE_TAG : null;
  const runId = numericId(source.GITHUB_RUN_ID);
  const attempt = numericId(source.GITHUB_RUN_ATTEMPT);
  const images = { public: validDigest(source.PUBLIC_DIGEST), admin: validDigest(source.ADMIN_DIGEST) };
  const jobs = {
    resolve: jobResult(source.RESOLVE_RESULT), checks: jobResult(source.CHECKS_RESULT),
    package: jobResult(source.PACKAGE_RESULT), deploy: jobResult(source.DEPLOY_RESULT),
  };
  const deploymentRequested = source.DEPLOY_REQUESTED === "true";
  const matched = Boolean(environment && (deploy?.environment ?? "production") === environment &&
    version && sha && runId && attempt && deploy?.version === version && deploy.sha === sha &&
    deploy.runId === runId && deploy.attempt === attempt &&
    ["public", "admin"].every((app) => images[app] && deploy.apps?.[app]?.digest === images[app]));
  const updates = Object.fromEntries(["public", "admin"].map((app) => [app,
    matched && ["not-started", "attempted", "verified"].includes(deploy.apps[app].update) ? deploy.apps[app].update : "unknown"]));
  const deploymentSmoke = Object.fromEntries(["public", "admin"].map((app) => [app,
    matched ? smokeResult(deploy.apps[app].smoke) : { outcome: "unknown" }]));
  const containerSmoke = jobResult(source.CONTAINER_SMOKE_RESULT);
  const packaged = Boolean(environment && tag && sha && images.public && images.admin && containerSmoke === "success" &&
    jobs.resolve === "success" && jobs.checks === "success" && jobs.package === "success");
  const deployed = matched && jobs.deploy === "success" && deploy.outcome === "success" &&
    ["public", "admin"].every((app) => updates[app] === "verified" && deploymentSmoke[app].outcome === "passed");
  const success = packaged && (!deploymentRequested || deployed);
  const partial = (matched && (deploy.outcome === "partial" || Object.values(updates).some((state) => ["attempted", "verified"].includes(state)))) ||
    (deploymentRequested && jobs.deploy === "success" && !deployed) ||
    (jobs.package !== "success" && Boolean(images.public || images.admin));
  return {
    schemaVersion: 3, environment, version, sha, tag,
    dispatchSha: validSha(source.GITHUB_SHA),
    runId, attempt, finishedAt: new Date().toISOString(),
    outcome: success ? "success" : partial ? "partial" : "failure",
    deploymentRequested, images, jobs, updates,
    smoke: { containers: containerSmoke, deployment: deploymentSmoke },
  };
}

function github(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  } catch {
    throw new Error("Durable release-attempt publication failed; the 90-day workflow artifact remains the fallback. Nothing was overwritten.");
  }
}

export function publishAttempt(record, repository, run = github, directory = "test-results") {
  validateRelease(record.version, record.sha, record.tag);
  if (!record.deploymentRequested || record.jobs.package !== "success" ||
      !numericId(record.runId) || !numericId(record.attempt) ||
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) {
    throw new Error("Durable attempt requires a resolved published release and a requested deployment.");
  }
  const release = JSON.parse(run(["release", "view", record.tag, "--repo", repository, "--json", "tagName,isDraft"]));
  if (release.tagName !== record.tag || release.isDraft !== false) throw new Error("Target release is missing, mismatched or not published.");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `release-attempt-${record.runId}-${record.attempt}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  run(["release", "upload", record.tag, file, "--repo", repository]);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--publish") {
    const record = JSON.parse(readFileSync("test-results/release-attempt.json", "utf8"));
    publishAttempt(record, process.env.GITHUB_REPOSITORY);
    console.log("Published this attempt's durable sanitized release asset; its outcome is unchanged.");
  } else {
    const deploy = existsSync("test-results/deployment.json")
      ? JSON.parse(readFileSync("test-results/deployment.json", "utf8")) : null;
    const record = createAttemptRecord(process.env, deploy);
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/release-attempt.json", JSON.stringify(record, null, 2) + "\n");
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Release attempt: ${record.outcome}\n\nTag: ${record.tag ?? "unresolved"}; release commit: ${record.sha ?? "unresolved"}; dispatch commit: ${record.dispatchSha ?? "unknown"}.\n\nImages: public \`${record.images.public ?? "not-published"}\`, admin \`${record.images.admin ?? "not-published"}\`.\n\nDeployment requested: ${record.deploymentRequested}. Container smoke: ${record.smoke.containers}. See the attempt artifact and environment/job history. Eligible deployment attempts also request a durable release-asset upload; its step reports success or failure. No automatic rollback is performed.\n`);
    }
  }
}

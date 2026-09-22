import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAttemptRecord, publishAttempt } from "./record.mjs";

const sha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const source = {
  RELEASE_VERSION: "1.2.3", RELEASE_SHA: sha, RELEASE_TAG: "v1.2.3",
  GITHUB_SHA: "c".repeat(40), GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
  PUBLIC_DIGEST: digest, ADMIN_DIGEST: digest,
  RESOLVE_RESULT: "success", CHECKS_RESULT: "success", PACKAGE_RESULT: "success",
  DEPLOY_REQUESTED: "true", DEPLOY_RESULT: "success", CONTAINER_SMOKE_RESULT: "success",
  AZURE_SUBSCRIPTION_ID: "never-publish-subscription",
  ADMIN_SITE_ORIGIN: "https://never-publish-endpoint.invalid",
  GH_TOKEN: "never-publish-token",
};
const evidence = () => ({
  version: source.RELEASE_VERSION, sha, runId: "123", attempt: "2", outcome: "success",
  resource: "never-publish-resource",
  apps: Object.fromEntries(["public", "admin"].map((app) => [app, {
    digest, update: "verified",
    smoke: { outcome: "passed", attempts: 1, endpoint: source.ADMIN_SITE_ORIGIN, error: "never-publish-provider-body" },
  }])),
});

test("attempt records identify the resolved release separately from dispatch and project only safe evidence", () => {
  const record = createAttemptRecord(source, evidence());
  assert.equal(record.outcome, "success");
  assert.equal(record.tag, "v1.2.3");
  assert.equal(record.sha, sha);
  assert.equal(record.dispatchSha, source.GITHUB_SHA);
  assert.equal(record.deploymentRequested, true);
  assert.deepEqual(record.updates, { public: "verified", admin: "verified" });
  assert.deepEqual(record.smoke.deployment.public, { outcome: "passed", attempts: 1 });
  assert.ok(!JSON.stringify(record).includes("never-publish"));
  assert.deepEqual(Object.keys(record).sort(), [
    "schemaVersion", "version", "sha", "tag", "dispatchSha", "runId", "attempt", "finishedAt",
    "outcome", "deploymentRequested", "images", "jobs", "updates", "smoke",
  ].sort());
});

test("attempt recording never infers successful deployment from a green job without matching evidence", () => {
  const missing = createAttemptRecord(source);
  assert.equal(missing.outcome, "partial");
  assert.deepEqual(missing.smoke.deployment.public, { outcome: "unknown" });
  const mismatch = evidence();
  mismatch.sha = "d".repeat(40);
  assert.equal(createAttemptRecord(source, mismatch).outcome, "partial");
  const failed = createAttemptRecord({ ...source, DEPLOY_RESULT: "failure" });
  assert.equal(failed.outcome, "failure");
  const partial = evidence();
  partial.outcome = "partial";
  partial.apps.admin.update = "attempted";
  partial.apps.admin.smoke = { outcome: "failed", error: "never-publish-provider-body" };
  const record = createAttemptRecord({ ...source, DEPLOY_RESULT: "failure" }, partial);
  assert.equal(record.outcome, "partial");
  assert.deepEqual(record.smoke.deployment.admin, { outcome: "failed" });
  assert.ok(!JSON.stringify(record).includes("never-publish"));
});

test("unresolved and pre-package attempts remain honest sanitized artifact-only records", () => {
  const unresolved = createAttemptRecord({
    ...source, RELEASE_VERSION: "never-publish-version", RELEASE_SHA: "never-publish-sha",
    RELEASE_TAG: "never-publish-tag", GITHUB_RUN_ID: "never-publish-run",
    PUBLIC_DIGEST: "", ADMIN_DIGEST: "", RESOLVE_RESULT: "failure", PACKAGE_RESULT: "skipped",
    DEPLOY_RESULT: "skipped", CONTAINER_SMOKE_RESULT: "never-publish-result",
  });
  assert.equal(unresolved.outcome, "failure");
  assert.equal(unresolved.version, null);
  assert.equal(unresolved.sha, null);
  assert.equal(unresolved.tag, null);
  assert.equal(unresolved.runId, null);
  assert.ok(!JSON.stringify(unresolved).includes("never-publish"));
  const unpublished = createAttemptRecord({ ...source, PACKAGE_RESULT: "failure", DEPLOY_RESULT: "skipped", ADMIN_DIGEST: "" });
  assert.equal(unpublished.outcome, "partial");
  const notRequested = createAttemptRecord({ ...source, DEPLOY_REQUESTED: "false", DEPLOY_RESULT: "skipped" });
  assert.equal(notRequested.outcome, "success");
  assert.equal(notRequested.deploymentRequested, false);
  assert.notEqual(createAttemptRecord({ ...source, RELEASE_TAG: "v9.9.9" }, evidence()).outcome, "success");
  for (const record of [unresolved, unpublished, notRequested]) {
    assert.throws(() => publishAttempt(record, "owner/repository", () => assert.fail("No GitHub call is allowed.")));
  }
});

test("success, failure and partial records attach unique assets to the published tag without clobber or creation", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "clamp-release-record-"));
  try {
    for (const [index, outcome] of ["success", "failure", "partial"].entries()) {
      const attempt = String(index + 1);
      const deployment = evidence();
      deployment.attempt = attempt;
      if (outcome === "failure") {
        deployment.outcome = "failure";
        for (const app of Object.values(deployment.apps)) {
          app.update = "not-started";
          app.smoke = { outcome: "not-run" };
        }
      } else if (outcome === "partial") {
        deployment.outcome = "partial";
        deployment.apps.admin.update = "attempted";
        deployment.apps.admin.smoke = { outcome: "failed" };
      }
      const record = createAttemptRecord({
        ...source, GITHUB_RUN_ATTEMPT: attempt, DEPLOY_RESULT: outcome === "success" ? "success" : "failure",
      }, deployment);
      assert.equal(record.outcome, outcome);
      const commands = [];
      const run = (args) => {
        commands.push(args);
        return args[1] === "view" ? JSON.stringify({ tagName: record.tag, isDraft: false }) : "";
      };
      const file = publishAttempt(record, "owner/repository", run, directory);
      assert.equal(path.basename(file), `release-attempt-123-${attempt}.json`);
      assert.deepEqual(commands[1], ["release", "upload", "v1.2.3", file, "--repo", "owner/repository"]);
      assert.ok(commands.every((args) => !args.includes("--clobber") && !args.includes("create")));
      const stored = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(stored.outcome, outcome);
      assert.equal(stored.sha, sha);
      assert.ok(!JSON.stringify(stored).includes("never-publish"));
      assert.throws(() => publishAttempt(record, "owner/repository", run, directory), /EEXIST/);
      assert.equal(commands.filter((args) => args[1] === "upload").length, 1);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("draft releases and failed durable uploads cannot replace the fallback artifact or fabricate a deployed claim", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "clamp-release-record-"));
  try {
    const record = createAttemptRecord({ ...source, DEPLOY_RESULT: "failure" });
    const artifact = path.join(directory, "release-attempt.json");
    const original = JSON.stringify(record);
    writeFileSync(artifact, original);
    assert.throws(() => publishAttempt(record, "owner/repository",
      () => JSON.stringify({ tagName: record.tag, isDraft: true }), directory), /not published/);
    const commands = [];
    assert.throws(() => publishAttempt(record, "owner/repository", (args) => {
      commands.push(args);
      if (args[1] === "view") return JSON.stringify({ tagName: record.tag, isDraft: false });
      throw new Error("Synthetic upload refusal");
    }, directory), /upload refusal/);
    assert.equal(readFileSync(artifact, "utf8"), original);
    assert.equal(JSON.parse(original).outcome, "failure");
    assert.deepEqual(commands.map((args) => args[1]), ["view", "upload"]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateRelease } from "./metadata.mjs";
import { smokeApp, smokeOrigin } from "./smoke.mjs";

export function imageReference(repository, digest, app) {
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repository) || !["public", "admin"].includes(app) ||
      !/^sha256:[a-f0-9]{64}$/.test(digest) || digest.length !== 71) throw new Error("Invalid immutable image reference.");
  return `ghcr.io/${repository}/${app}@${digest}`;
}

export function deploymentSettings(source) {
  if (source.ENABLE_PRODUCTION_DEPLOY !== "true") throw new Error("Production deployment is not explicitly enabled.");
  if (source.GITHUB_REF !== "refs/heads/master") throw new Error("Dispatch deployment from master only.");
  for (const key of ["AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID", "AZURE_RESOURCE_GROUP",
    "PUBLIC_CONTAINER_APP", "ADMIN_CONTAINER_APP", "PUBLIC_SITE_ORIGIN", "ADMIN_SITE_ORIGIN"]) {
    if (!source[key]?.trim()) throw new Error(`Missing required deployment setting: ${key}.`);
  }
  if (source.PUBLIC_CONTAINER_APP === source.ADMIN_CONTAINER_APP || source.PUBLIC_SITE_ORIGIN === source.ADMIN_SITE_ORIGIN) {
    throw new Error("Public and admin targets/origins must be separate.");
  }
  smokeOrigin(source.PUBLIC_SITE_ORIGIN);
  smokeOrigin(source.ADMIN_SITE_ORIGIN);
  validateRelease(source.RELEASE_VERSION, source.RELEASE_SHA);
  const repository = source.GITHUB_REPOSITORY.toLowerCase();
  return {
    group: source.AZURE_RESOURCE_GROUP,
    public: { app: source.PUBLIC_CONTAINER_APP, origin: source.PUBLIC_SITE_ORIGIN, image: imageReference(repository, source.PUBLIC_DIGEST, "public") },
    admin: { app: source.ADMIN_CONTAINER_APP, origin: source.ADMIN_SITE_ORIGIN, image: imageReference(repository, source.ADMIN_DIGEST, "admin") },
  };
}

export function assertExistingTarget(target, origin) {
  const properties = target?.properties;
  const configuration = properties?.configuration;
  if (configuration?.activeRevisionsMode !== "Single" || !configuration.ingress?.external ||
      configuration.ingress.targetPort !== 3000 || configuration.ingress.allowInsecure === true ||
      properties?.template?.containers?.length !== 1 || !properties.template.containers[0].name) {
    throw new Error("Existing target must use Single revision mode, one container and HTTPS external ingress on port 3000.");
  }
  if (origin) {
    const domains = [configuration.ingress.fqdn, ...(configuration.ingress.customDomains ?? []).map((domain) => domain.name)];
    if (!domains.includes(new URL(origin).hostname)) throw new Error("Configured smoke origin does not belong to its application.");
  }
  return properties.template.containers[0].name;
}

export function deploymentOutcome(apps) {
  if (Object.values(apps).every((app) => app.update === "verified" && app.smoke.outcome === "passed")) return "success";
  return Object.values(apps).some((app) => app.update !== "not-started") ? "partial" : "failure";
}

export function assertProtectedEnvironment(environment) {
  const reviewers = environment?.protection_rules?.find((rule) => rule.type === "required_reviewers");
  if (!reviewers?.reviewers?.length || reviewers.prevent_self_review !== true) {
    throw new Error("Production environment must require reviewer approval and prevent self-review.");
  }
}

function azure(args) {
  try {
    return JSON.parse(execFileSync("az", [...args, "--only-show-errors", "--output", "json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024,
      timeout: args[1] === "update" ? 120_000 : 20_000,
    }));
  } catch {
    // Azure errors can contain subscription IDs, resource names or endpoints.
    throw new Error("Azure operation failed; inspect private Azure diagnostics. No rollback was attempted.");
  }
}

export async function deploy(source = process.env, transport = azure, smoke = smokeApp, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const record = {
    schemaVersion: 1, version: source.RELEASE_VERSION, sha: source.RELEASE_SHA,
    runId: source.GITHUB_RUN_ID, attempt: source.GITHUB_RUN_ATTEMPT,
    startedAt: new Date().toISOString(), finishedAt: null, outcome: "failure",
    apps: {
      public: { digest: source.PUBLIC_DIGEST, update: "not-started", smoke: { outcome: "not-run" } },
      admin: { digest: source.ADMIN_DIGEST, update: "not-started", smoke: { outcome: "not-run" } },
    },
  };
  let error;
  try {
    const settings = deploymentSettings(source);
    const containers = {};
    // Preflight both resources before changing either one; never provision or set secrets.
    for (const app of ["public", "admin"]) {
      containers[app] = assertExistingTarget(transport(["containerapp", "show", "--name", settings[app].app, "--resource-group", settings.group]), settings[app].origin);
    }
    for (const app of ["public", "admin"]) {
      const target = settings[app];
      const result = record.apps[app];
      result.update = "attempted";
      transport(["containerapp", "update", "--name", target.app, "--resource-group", settings.group,
        "--container-name", containers[app], "--image", target.image]);
      let ready = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const state = transport(["containerapp", "show", "--name", target.app, "--resource-group", settings.group]);
        const properties = state.properties;
        if (properties?.provisioningState === "Succeeded" &&
            properties.latestRevisionName && properties.latestRevisionName === properties.latestReadyRevisionName &&
            properties.template?.containers?.[0]?.image === target.image) {
          ready = true;
          break;
        }
        await sleep(10_000);
      }
      if (!ready) throw new Error(`${app} image/readiness verification did not complete.`);
      result.update = "verified";
      result.smoke = { outcome: "failed" };
      result.smoke = await smoke({ app, origin: target.origin, version: source.RELEASE_VERSION, sha: source.RELEASE_SHA });
    }
  } catch (failure) {
    error = failure;
  }
  record.finishedAt = new Date().toISOString();
  record.outcome = deploymentOutcome(record.apps);
  return { record, error };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { record, error } = await deploy();
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/deployment.json", JSON.stringify(record, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${record.outcome}\n`);
  if (error) {
    console.error(`Deployment ${record.outcome}; see the redacted attempt record. No automatic rollback was attempted.`);
    process.exitCode = 1;
  }
}

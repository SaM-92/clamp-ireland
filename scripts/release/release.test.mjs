import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateRelease, buildReleaseEnvironment } from "./metadata.mjs";
import { syntheticEnvironment, disabledAiEnvironment } from "../ci/environment.mjs";
import { smokeApp, smokeOrigin } from "./smoke.mjs";
import { assertExistingTarget, assertProtectedEnvironment, deploy, deploymentSettings, imageReference } from "./deployment.mjs";
import { requireNetworkIsolationReady } from "./network-policy.mjs";

const sha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const version = "1.2.3";
test("cloud deployment remains blocked until every backend meets the IP-isolation requirement", async () => {
  assert.throws(requireNetworkIsolationReady, /all-endpoint IP isolation is incomplete/);
  const blocked = await deploy(settings);
  assert.equal(blocked.record.outcome, "failure");
  assert.equal(blocked.record.apps.public.update, "not-started");
  assert.equal(blocked.record.apps.admin.update, "not-started");
});
const settings = {
  APPROVED_CLIENT_IPV4S: '["203.0.113.10"]',
  ENABLE_PRODUCTION_DEPLOY: "true", GITHUB_REF: "refs/heads/master",
  GITHUB_REPOSITORY: "owner/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
  RELEASE_VERSION: version, RELEASE_SHA: sha,
  AZURE_CLIENT_ID: "synthetic-client", AZURE_TENANT_ID: "synthetic-tenant",
  AZURE_SUBSCRIPTION_ID: "synthetic-subscription", AZURE_RESOURCE_GROUP: "synthetic-group",
  PUBLIC_CONTAINER_APP: "public-fixture", ADMIN_CONTAINER_APP: "admin-fixture",
  PUBLIC_SITE_ORIGIN: "https://public.fixture.invalid", ADMIN_SITE_ORIGIN: "https://admin.fixture.invalid",
  PUBLIC_DIGEST: digest, ADMIN_DIGEST: digest,
};
const target = (image) => ({ properties: {
  provisioningState: "Succeeded", latestRevisionName: "fixture-revision", latestReadyRevisionName: "fixture-revision",
  configuration: { activeRevisionsMode: "Single", ingress: {
    external: true, targetPort: 3000, allowInsecure: false,
    fqdn: "public.fixture.invalid", customDomains: [{ name: "admin.fixture.invalid" }],
    ipSecurityRestrictions: [{ name: "synthetic-client", action: "Allow", ipAddressRange: "203.0.113.10/32" }],
  } },
  template: { containers: [{ name: "fixture", image }] },
} });

test("Next's compiled config loader resolves shared release metadata for both application roots", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const script = `
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const {createRequire} = require("node:module");
    const root = process.argv[1];
    const load = createRequire(path.join(root, "package.json"));
    const {transpileConfig} = load("next/dist/build/next-config-ts/transpile-config");
    (async () => {
      process.chdir(path.join(root, "apps", "admin"));
      for (const app of [".", "apps/admin"]) {
        const dir = path.join(root, app);
        const {default: config} = await transpileConfig({nextConfigPath: path.join(dir, "next.config.ts"), dir});
        assert.equal(config.output, "standalone");
        assert.equal(config.env.APP_RELEASE_VERSION, load("./package.json").version);
        assert.equal(config.env.APP_RELEASE_SHA, process.env.APP_RELEASE_SHA);
      }
    })().catch(() => {console.error("Compiled application config failed to load.");process.exitCode = 1;});
  `;
  const result = spawnSync(process.execPath, ["-e", script, root], {
    env: syntheticEnvironment({ ...process.env, APP_RELEASE_SHA: sha, RELEASE_BUILD: "true" }),
    encoding: "utf8", timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("stable tag is exact, full SHA is required, build version is taken from package only", () => {
  assert.deepEqual(validateRelease(version, sha, "v1.2.3"), { version, sha, tag: "v1.2.3" });
  for (const tag of ["v01.2.3", "1.2.3", "v2.0.0", "v1.2.3\n", "main"]) assert.throws(() => validateRelease(version, sha, tag));
  for (const commit of ["local", "latest", "a".repeat(7), `${sha}\n`]) assert.throws(() => validateRelease(version, commit));
  assert.throws(() => buildReleaseEnvironment({ RELEASE_BUILD: "true" }));
  const packageVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url))).version;
  assert.deepEqual(buildReleaseEnvironment({ APP_RELEASE_VERSION: "999.0.0", APP_RELEASE_SHA: sha, RELEASE_BUILD: "true" }), {
    APP_RELEASE_VERSION: packageVersion, APP_RELEASE_SHA: sha,
  });
});

test("synthetic environment drops arbitrary secrets and real service/model settings", () => {
  const clean = syntheticEnvironment({
    PATH: "fixture-bin", SECRET: "never", GH_TOKEN: "never", AZURE_TOKEN: "never", OPENAI_API_KEY: "never",
    NEXT_PUBLIC_SUPABASE_URL: "https://real.invalid", ENABLE_AREA_SUMMARIES: "true", APP_RELEASE_SHA: sha,
    AI_PROVIDER: "azure", ENABLE_LOCAL_AI_DEMO: "true", AZURE_OPENAI_ENDPOINT: "https://real.fixture.invalid",
    AZURE_OPENAI_DEPLOYMENT: "real-deployment", AZURE_CLIENT_ID: "real-identity", IDENTITY_ENDPOINT: "http://real.fixture.invalid",
  });
  assert.equal(clean.PATH, "fixture-bin");
  assert.equal(clean.APP_RELEASE_SHA, sha);
  assert.equal(clean.OPENAI_API_KEY, "");
  assert.equal(clean.ENABLE_AREA_SUMMARIES, "false");
  assert.equal(clean.NEXT_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(clean.SECRET, undefined);
  assert.equal(clean.GH_TOKEN, undefined);
  assert.equal(clean.AZURE_TOKEN, undefined);
  assert.equal(clean.AI_PROVIDER, "openai");
  assert.equal(clean.ENABLE_LOCAL_AI_DEMO, "false");
  for (const [key, value] of Object.entries(disabledAiEnvironment)) {
    assert.equal(clean[key], value, key);
  }
});

test("network guard blocks external fetch and both net connection signatures before I/O", () => {
  const result = spawnSync(process.execPath, ["--import", "./scripts/ci/deny-network.mjs", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import net from "node:net";
    assert.throws(() => fetch("https://provider.invalid"), /prohibit/);
    assert.throws(() => net.connect(443, "provider.invalid"), /prohibit/);
    assert.throws(() => net.connect({port:443, host:"provider.invalid"}), /prohibit/);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("deployment refuses missing settings, duplicate targets, mutable tags and unsafe environment policy", () => {
  assert.equal(deploymentSettings(settings).public.image, `ghcr.io/owner/repository/public@${digest}`);
  for (const key of Object.keys(settings).filter((key) => /^(AZURE_|PUBLIC_|ADMIN_)/.test(key))) {
    assert.throws(() => deploymentSettings({ ...settings, [key]: "" }), key);
  }
  assert.throws(() => deploymentSettings({ ...settings, ENABLE_PRODUCTION_DEPLOY: "TRUE" }));
  assert.throws(() => deploymentSettings({ ...settings, GITHUB_REF: "refs/tags/v1.2.3" }));
  assert.throws(() => deploymentSettings({ ...settings, ADMIN_CONTAINER_APP: settings.PUBLIC_CONTAINER_APP }));
  assert.throws(() => imageReference("owner/repo", "latest", "public"));
  assert.throws(() => imageReference("owner/repo", digest + "\n", "public"));
  for (const value of [null, {}, { protection_rules: [{ type: "required_reviewers", reviewers: [1], prevent_self_review: false }] }]) {
    assert.throws(() => assertProtectedEnvironment(value));
  }
  assertProtectedEnvironment({ protection_rules: [{ type: "required_reviewers", reviewers: [1], prevent_self_review: true }] });
  assert.throws(() => assertExistingTarget({ properties: { ...target("").properties,
    configuration: { activeRevisionsMode: "Multiple" } } }));
  assert.throws(() => assertExistingTarget(target(""), "https://unrelated.fixture.invalid"));
});

test("smoke uses only bounded GETs, exact metadata and no private admin data", async () => {
  for (const value of ["http://remote.invalid", "https://user:password@remote.invalid", "https://remote.invalid/path", "https://remote.invalid/"]) {
    assert.throws(() => smokeOrigin(value));
  }
  const paths = [];
  const fetchImpl = async (url, init) => {
    paths.push(new URL(url).pathname);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, undefined);
    return new URL(url).pathname === "/api/health"
      ? Response.json({ status: "ok", version, sha }, { headers: { "Cache-Control": "no-store" } })
      : new Response(null, { status: 404 });
  };
  assert.deepEqual(await smokeApp({ app: "public", origin: settings.PUBLIC_SITE_ORIGIN, version, sha, fetchImpl }), {
    outcome: "passed", attempts: 1,
  });

  assert.deepEqual(paths, [
    "/api/health", "/admin", "/api/admin/overview", "/api/moderation/reports",
    "/dev/ai-demo", "/api/dev/ai-demo",
  ]);
  let calls = 0;
  await assert.rejects(smokeApp({
    app: "public", origin: settings.PUBLIC_SITE_ORIGIN, version, sha, attempts: 2, delayMs: 0,
    fetchImpl: async () => { calls++; return Response.json({ status: "ok", version, sha: "stale" }); },
  }), /failed after 2/);
  assert.equal(calls, 2);
  await assert.rejects(smokeApp({ app: "public", origin: settings.PUBLIC_SITE_ORIGIN, version, sha, attempts: 13 }));
});

test("development promotion has an independent opt-in and cannot cross production target tags", async () => {
  const development = { ...settings, DEPLOY_ENVIRONMENT: "development", ENABLE_DEVELOPMENT_DEPLOY: "true", ENABLE_PRODUCTION_DEPLOY: "" };
  assert.equal(deploymentSettings(development).environment, "development");
  assert.throws(() => deploymentSettings({ ...development, ENABLE_DEVELOPMENT_DEPLOY: "" }));
  assert.throws(() => deploymentSettings({ ...development, DEPLOY_ENVIRONMENT: "production" }));
  assert.throws(() => deploymentSettings({ ...settings, DEPLOY_ENVIRONMENT: "other" }));
  const tagged = { ...target(""), tags: { environment: "development", workload: "clamp-ireland" } };
  assert.equal(assertExistingTarget(tagged, settings.PUBLIC_SITE_ORIGIN, "development"), "fixture");
  assert.throws(() => assertExistingTarget(target(""), settings.PUBLIC_SITE_ORIGIN, "development"));
  assert.throws(() => assertExistingTarget(tagged, settings.PUBLIC_SITE_ORIGIN, "production"));
  const denied = await deploy(development, () => target(""));
  assert.equal(denied.record.environment, "development");
  assert.equal(denied.record.outcome, "failure");
  assert.equal(denied.record.apps.public.update, "not-started");
});

test("promotion rejects missing, widened, duplicate or different IP allowlists before changing resources", async () => {
  for (const value of ["", "[]", '["0.0.0.0/0"]', '["203.0.113.10","203.0.113.10"]', '["203.0.113.10/32"]']) {
    assert.throws(() => deploymentSettings({ ...settings, APPROVED_CLIENT_IPV4S: value }));
  }
  for (const restrictions of [[], [{ action: "Allow", ipAddressRange: "0.0.0.0/0" }],
    [{ action: "Deny", ipAddressRange: "203.0.113.10/32" }],
    [{ action: "Allow", ipAddressRange: "203.0.113.11/32" }]]) {
    const candidate = target("");
    candidate.properties.configuration.ingress.ipSecurityRestrictions = restrictions;
    assert.throws(() => assertExistingTarget(candidate, settings.PUBLIC_SITE_ORIGIN, "production", ["203.0.113.10/32"]));
    const result = await deploy(settings, () => candidate);
    assert.equal(result.record.apps.public.update, "not-started");
    assert.equal(result.record.apps.admin.update, "not-started");
  }
});

test("deployment preflights both existing targets, updates digests only, records success without identifiers", async () => {
  const calls = [];
  const images = {};
  const transport = (args) => {
    calls.push(args);
    const name = args[args.indexOf("--name") + 1];
    if (args[1] === "update") images[name] = args[args.indexOf("--image") + 1];
    return target(images[name]);
  };
  const { record, error } = await deploy(settings, transport, async () => ({ outcome: "passed", attempts: 1 }));
  assert.equal(error, undefined);
  assert.equal(record.outcome, "success");
  assert.equal(calls[0][1], "show");
  assert.equal(calls[1][1], "show");
  assert.equal(calls.filter((args) => args[1] === "update").length, 2);
  assert.ok(calls.every((args) => ["show", "update"].includes(args[1])));
  assert.ok(Object.values(images).every((image) => image.endsWith(`@${digest}`)));
  const json = JSON.stringify(record);
  for (const secret of [settings.AZURE_SUBSCRIPTION_ID, settings.AZURE_RESOURCE_GROUP, settings.PUBLIC_CONTAINER_APP, settings.PUBLIC_SITE_ORIGIN]) {
    assert.ok(!json.includes(secret));
  }
});

test("admin smoke accepts only liveness, denial and same-origin sign-in; cold starts are retried", async () => {
  let calls = 0;
  const adminFetch = async (url) => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503 });
    const path = new URL(url).pathname;
    if (path === "/api/health") return Response.json({ status: "ok" }, { headers: { "Cache-Control": "private, no-store" } });
    if (path === "/api/admin/overview") return new Response(null, { status: 403 });
    if (path === "/admin") return new Response(null, { status: 307, headers: { Location: "/auth/sign-in" } });
    return new Response("Synthetic sign-in", { status: 200 });
  };
  assert.deepEqual(await smokeApp({
    app: "admin", origin: settings.ADMIN_SITE_ORIGIN, version, sha, attempts: 2, delayMs: 0, fetchImpl: adminFetch,
  }), { outcome: "passed", attempts: 2 });
  assert.equal(calls, 5);
  await assert.rejects(smokeApp({
    app: "admin", origin: settings.ADMIN_SITE_ORIGIN, version, sha, attempts: 1,
    fetchImpl: async () => Response.json({ status: "ok", privateData: "must-not-pass" }),
  }), /failed/);
});

test("preflight failure changes nothing; failures after a possible update are partial, never rolled back", async () => {
  let updates = 0;
  const denied = await deploy(settings, () => { throw new Error("missing resource"); });
  assert.equal(denied.record.outcome, "failure");
  assert.equal(denied.record.apps.public.update, "not-started");
  const partial = await deploy(settings, (args) => {
    if (args[1] === "update") { updates++; throw new Error("timeout after update may have started"); }
    return target("");
  });
  assert.equal(partial.record.outcome, "partial");
  assert.equal(partial.record.apps.public.update, "attempted");
  assert.equal(partial.record.apps.admin.update, "not-started");
  assert.equal(updates, 1);
});

test("smoke failure stops promotion to the second app and preserves honest partial state", async () => {
  let image;
  const { record } = await deploy(settings, (args) => {
    if (args[1] === "update") image = args[args.indexOf("--image") + 1];
    return target(image);
  }, async () => { throw new Error("unhealthy"); });
  assert.equal(record.outcome, "partial");
  assert.equal(record.apps.public.update, "verified");
  assert.equal(record.apps.public.smoke.outcome, "failed");
  assert.equal(record.apps.admin.update, "not-started");
});

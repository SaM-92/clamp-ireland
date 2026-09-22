import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = JSON.parse(readFileSync("test-results/infra.json", "utf8"));
function collect(document) {
  return Object.values(document.resources ?? {}).flatMap((resource) => [
    resource, ...(resource.properties?.template?.resources ? collect(resource.properties.template) : []),
  ]);
}
const resources = collect(template);
const ofType = (type) => resources.filter((r) => r.type === type);

test("the infrastructure is restricted to the approved non-production group and region", () => {
  assert.deepEqual(template.parameters.resourceGroupName.allowedValues, ["rg-clamp-ireland-dev"]);
  assert.deepEqual(template.parameters.location.allowedValues, ["northeurope"]);
  const network = template.parameters.clientNetwork;
  const networkType = network.$ref ? template.definitions[network.$ref.split("/").at(-1)] : network;
  assert.equal(networkType.type.toLowerCase(), "secureobject");
  assert.equal(networkType.properties.allowedClientIpv4.minLength, 1);
  assert.equal(template.parameters.clientNetwork.defaultValue, undefined);
  for (const name of ["supabaseAnonKey", "supabaseServiceRoleKey", "adminAllowedUserIds", "budgetContactEmail"]) {
    assert.equal(template.parameters[name].type, "securestring");
    assert.equal(template.parameters[name].defaultValue, undefined);
  }
  for (const name of ["publicImageDigest", "adminImageDigest"]) {
    assert.equal(template.parameters[name].minLength, 64);
    assert.equal(template.parameters[name].maxLength, 64);
  }
  const source = JSON.stringify(template);
  assert.match(source, /ghcr\.io\/sam-92\/clamp-ireland\/public@sha256:/);
  assert.match(source, /ghcr\.io\/sam-92\/clamp-ireland\/admin@sha256:/);
  assert.doesNotMatch(source, /listKeys|:latest|containerapps-helloworld/i);
});

test("only bounded Consumption apps and explicitly chosen support resources can be provisioned", () => {
  const allowed = new Set([
    "Microsoft.Resources/resourceGroups", "Microsoft.Resources/deployments",
    "Microsoft.ManagedIdentity/userAssignedIdentities", "Microsoft.Storage/storageAccounts",
    "Microsoft.Storage/storageAccounts/blobServices", "Microsoft.Storage/storageAccounts/blobServices/containers",
    "Microsoft.Authorization/roleAssignments", "Microsoft.App/managedEnvironments",
    "Microsoft.App/containerApps", "Microsoft.Consumption/budgets",
  ]);
  assert.ok(resources.every((resource) => allowed.has(resource.type)));
  assert.equal(ofType("Microsoft.App/containerApps").length, 2);
  for (const { properties: app } of ofType("Microsoft.App/containerApps")) {
    assert.equal(app.template.scale.minReplicas, 0);
    assert.equal(app.template.scale.maxReplicas, 1);
    assert.equal(app.workloadProfileName, "Consumption");
    assert.equal(app.configuration.activeRevisionsMode, "Single");
    assert.equal(app.configuration.ingress.allowInsecure, false);
    assert.equal(app.configuration.ingress.targetPort, 3000);
    const allowlist = app.configuration.ingress.copy.find((entry) => entry.name === "ipSecurityRestrictions");
    assert.equal(allowlist.input.action, "Allow");
    assert.match(allowlist.input.ipAddressRange, /\/32/);
    assert.match(allowlist.count, /allowedClientIpv4/);
    assert.deepEqual(app.template.containers[0].probes.map((p) => p.type), ["Startup", "Liveness", "Readiness"]);
  }
  for (const environment of ofType("Microsoft.App/managedEnvironments")) {
    assert.deepEqual(environment.properties.workloadProfiles, [{ name: "Consumption", workloadProfileType: "Consumption" }]);
    assert.equal(environment.properties.appLogsConfiguration.destination, "none");
  }
});

test("private LRS evidence forbids anonymous/key access and uses scoped roles rather than account keys", () => {
  const storage = ofType("Microsoft.Storage/storageAccounts")[0];
  assert.equal(storage.sku.name, "Standard_LRS");
  assert.equal(storage.properties.accessTier, "Hot");
  assert.equal(storage.properties.allowBlobPublicAccess, false);
  assert.equal(storage.properties.allowSharedKeyAccess, false);
  assert.equal(storage.properties.minimumTlsVersion, "TLS1_2");
  assert.equal(storage.properties.supportsHttpsTrafficOnly, true);
  assert.equal(storage.properties.networkAcls.defaultAction, "Deny");
  assert.equal(storage.properties.networkAcls.bypass, "None");
  const evidence = ofType("Microsoft.Storage/storageAccounts/blobServices/containers")[0];
  assert.equal(evidence.properties.publicAccess, "None");
  const blobs = ofType("Microsoft.Storage/storageAccounts/blobServices")[0].properties;
  assert.deepEqual(blobs.deleteRetentionPolicy, { enabled: true, days: 7 });
  assert.equal(blobs.isVersioningEnabled, false);
  const roles = ofType("Microsoft.Authorization/roleAssignments");
  assert.ok(roles.every((r) => r.properties.principalType === "ServicePrincipal" && r.scope));
  assert.equal(roles.filter((r) => r.scope.includes("containers")).length, 2);
});

test("cost controls are notifications, not a hard stop, and no contact or budget is invented", () => {
  const budget = ofType("Microsoft.Consumption/budgets")[0].properties;
  assert.equal(template.parameters.monthlyBudgetInBillingCurrency.defaultValue, undefined);
  assert.equal(budget.timeGrain, "Monthly");
  assert.deepEqual(Object.values(budget.notifications).map((n) => [n.thresholdType, n.threshold]), [
    ["Actual", 50], ["Actual", 100], ["Forecasted", 100],
  ]);
  assert.ok(Object.values(budget.notifications).every((n) => n.enabled && n.contactEmails.length === 1));
});

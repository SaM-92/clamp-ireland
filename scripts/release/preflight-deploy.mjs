import { execFileSync } from "node:child_process";
import { deploymentSettings, assertProtectedEnvironment } from "./deployment.mjs";
import { requireNetworkIsolationReady } from "./network-policy.mjs";

requireNetworkIsolationReady();
const settings = deploymentSettings(process.env);
let environment;
try {
  environment = JSON.parse(execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/environments/${settings.environment}`], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }));
} catch {
  throw new Error("Could not verify deployment environment protection; deployment is blocked.");
}
assertProtectedEnvironment(environment);
console.log(`Explicit ${settings.environment} opt-in, separate configured targets and reviewer protection verified.`);

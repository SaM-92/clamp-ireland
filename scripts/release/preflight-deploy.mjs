import { execFileSync } from "node:child_process";
import { deploymentSettings, assertProtectedEnvironment } from "./deployment.mjs";

deploymentSettings(process.env);
let environment;
try {
  environment = JSON.parse(execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/environments/production`], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }));
} catch {
  throw new Error("Could not verify production environment protection; deployment is blocked.");
}
assertProtectedEnvironment(environment);
console.log("Explicit opt-in, separate configured targets and production reviewer protection verified.");

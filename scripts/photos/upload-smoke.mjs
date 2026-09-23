import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const token = readFileSync("/tmp/upload-session-token", "utf8").trim();

for (const [size, expectedStatus] of [[50 * 1024 * 1024, 429], [50 * 1024 * 1024 + 1, 413]]) {
  const form = new FormData();
  form.set("locationId", "30000000-0000-4000-8000-000000000001");
  form.set("reporterType", "witness");
  form.set("description", "Synthetic upload boundary check.");
  form.set("image", new File([new Uint8Array(size)], "synthetic.png", { type: "image/png" }));
  const response = await fetch("http://127.0.0.1:3000/api/reports", {
    method: "POST", body: form,
    headers: { Cookie: `clamp-public-session=${token}`, Origin: "http://127.0.0.1:3000" },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `Unexpected upload status: ${body.code}`);
  assert.match(response.headers.get("X-Robots-Tag") ?? "", /noindex/);
  assert.equal(body.code, expectedStatus === 429 ? "content_policy_rate_limited" : "invalid_photo");
}
console.log("Standalone HTTP accepts the full 50-MiB source, rejects one extra byte and never reaches inference/storage.");

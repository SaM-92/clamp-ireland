import { pathToFileURL } from "node:url";
import { validateRelease } from "./metadata.mjs";

export function smokeOrigin(value, allowLoopback = false) {
  const url = new URL(value);
  const local = allowLoopback && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || !["https:", "http:"].includes(url.protocol) ||
      url.username || url.password || url.origin !== value) throw new Error("Smoke origin must be a credential-free HTTPS origin.");
  return url.origin;
}

export async function smokeApp({ app, origin, version, sha, attempts = 12, delayMs = 10_000, allowLoopback = false, fetchImpl = fetch }) {
  if (!["public", "admin"].includes(app)) throw new Error("Invalid smoke application.");
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 12 || delayMs < 0 || delayMs > 10_000) throw new Error("Unbounded smoke retry configuration.");
  validateRelease(version, sha);
  smokeOrigin(origin, allowLoopback);
  const check = async (path, statuses, signal) => {
    const response = await fetchImpl(`${origin}${path}`, {
      method: "GET", redirect: "manual", cache: "no-store", signal,
      headers: { "User-Agent": "ClampReleaseSmoke/1.0" },
    });
    if (!statuses.includes(response.status)) throw new Error("Unexpected smoke status.");
    return response;
  };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const signal = AbortSignal.timeout(10_000);
      const health = await check("/api/health", [200], signal);
      const text = await health.text();
      if (text.length > 1024) throw new Error("Health response too large.");
      const body = JSON.parse(text);
      const expected = app === "public" ? { status: "ok", version, sha } : { status: "ok" };
      if (Object.keys(body).sort().join() !== Object.keys(expected).sort().join() ||
          Object.entries(expected).some(([key, value]) => body[key] !== value)) throw new Error("Unexpected health projection or release.");
      if (!health.headers.get("cache-control")?.includes("no-store")) throw new Error("Health must not be cached.");
      if (app === "public") {
        for (const path of ["/admin", "/api/admin/overview", "/api/moderation/reports", "/dev/ai-demo", "/api/dev/ai-demo"]) {
          await check(path, [404], signal);
        }
      } else {
        await check("/api/admin/overview", [403], signal);
        const page = await check("/admin", [307, 308], signal);
        const location = page.headers.get("location");
        if (!location || new URL(location, origin).href !== `${origin}/auth/sign-in`) throw new Error("Private page did not redirect to sign-in.");
        await check("/auth/sign-in", [200], signal);
      }
      return { outcome: "passed", attempts: attempt };
    } catch {
      if (attempt === attempts) throw new Error(`${app} read-only smoke failed after ${attempts} bounded attempts.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Smoke did not run.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await smokeApp({
    app: process.env.SMOKE_APP, origin: process.env.SMOKE_ORIGIN,
    version: process.env.RELEASE_VERSION, sha: process.env.RELEASE_SHA,
    allowLoopback: process.env.SMOKE_LOOPBACK === "true",
  });
  console.log("Read-only release smoke passed.");
}

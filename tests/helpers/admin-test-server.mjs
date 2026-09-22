import http from "node:http";
import path from "node:path";
import next from "next";

// Only test transport is replaced; the app's real page/API auth gates run.
const ids = {
  "owner-session": "10000000-0000-4000-8000-000000000001",
  "cofounder-session": "10000000-0000-4000-8000-000000000002",
  "outsider-session": "10000000-0000-4000-8000-000000000003",
  "unconfirmed-session": "10000000-0000-4000-8000-000000000001",
};
const production = process.env.PLAYWRIGHT_ADMIN_PRODUCTION === "true";
const user = (token) => ids[token] ? {
  id: ids[token], email: "admin@fixture.invalid", aud: "authenticated", role: "authenticated",
  email_confirmed_at: token === "unconfirmed-session" ? null : "2026-09-22T10:00:00Z",
} : null;

const identity = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  response.setHeader("Content-Type", "application/json");
  if (url.pathname === "/auth/v1/user") {
    const found = user(request.headers.authorization?.replace(/^Bearer /, ""));
    response.statusCode = found ? 200 : 401;
    response.end(JSON.stringify(found ?? { message: "Invalid fixture session" }));
  } else if (url.pathname === "/auth/v1/token" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const token = input.email === "owner@fixture.invalid" ? "owner-session"
      : input.email === "cofounder@fixture.invalid" ? "cofounder-session" : "outsider-session";
    if (input.password !== "fixture-password") {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid fixture credentials" }));
      return;
    }
    response.end(JSON.stringify({
      access_token: token, token_type: "bearer", refresh_token: "unused-fixture-refresh",
      expires_in: 3600, user: user(token),
    }));
  } else if (url.pathname === "/rest/v1/profiles" && request.method !== "HEAD") {
    response.end(JSON.stringify({ is_admin: true, is_banned: false }));
  } else if (request.method === "HEAD") {
    response.setHeader("Content-Range", "*/0");
    response.end();
  } else if (["/rest/v1/reports", "/rest/v1/locations_public"].includes(url.pathname)) {
    response.end("[]");
  } else {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Unexpected fixture request" }));
  }
});
await new Promise((resolve) => identity.listen(0, "127.0.0.1", resolve));
const address = identity.address();
if (!address || typeof address === "string") throw new Error("Identity fixture did not start.");
Object.assign(process.env, {
  NODE_ENV: production ? "production" : "development",
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  ADMIN_ALLOWED_USER_IDS: `${ids["owner-session"]},${ids["cofounder-session"]}`,
  ADMIN_SITE_URL: "http://127.0.0.1:3016",
  ENABLE_AREA_SUMMARIES: "false", ENABLE_TRAFFIC_ANALYTICS: "false",
  OPENAI_API_KEY: "", SITE_URL: "", ALLOW_INDEXING: "false",
});
const app = next({ dev: !production, dir: path.resolve("apps", "admin"), hostname: "127.0.0.1", port: 3016 });
const handler = app.getRequestHandler();
await app.prepare();
const server = http.createServer((request, response) => handler(request, response));
await new Promise((resolve) => server.listen(3016, "127.0.0.1", resolve));
console.log("Isolated admin test server ready on 127.0.0.1:3016");
async function close() {
  server.closeAllConnections(); server.close();
  identity.closeAllConnections(); identity.close();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

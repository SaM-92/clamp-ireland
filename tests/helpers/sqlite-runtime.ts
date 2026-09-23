import { randomBytes, createHash, randomUUID } from "node:crypto";
import { openDatabase, transaction } from "../../database/store.mjs";
import { policyRuntime } from "./content-policy-runtime";

export const owner = "20000000-0000-4000-8000-000000000001";
export const cofounder = "20000000-0000-4000-8000-000000000002";
export const outsider = "20000000-0000-4000-8000-000000000003";
export const locationId = "30000000-0000-4000-8000-000000000001";
export const publicOrigin = "https://public.fixture.invalid";
export const adminOrigin = "https://admin.fixture.invalid";

export function sqliteRuntime(dependencies: Record<string, unknown> = {}, globals: Record<string, unknown> = {}, filename = ":memory:") {
  const db = openDatabase(filename);
  for (const [id, name, admin] of [[owner, "river_walker", 1], [cofounder, "park_walker", 1], [outsider, "other_walker", 0]] as const) {
    db.prepare(`INSERT OR IGNORE INTO profiles(id,google_subject,email,display_name,username_policy_checked_at,is_admin)
      VALUES (?,?,?,?,?,?)`).run(id, `google-${id}`, `${name}@fixture.invalid`, name, new Date().toISOString(), admin);
  }
  db.prepare("INSERT OR IGNORE INTO locations(id,lat,lng) VALUES (?,53.3,-6.2)").run(locationId);
  const environment = {
    DATABASE_PATH: filename, AUTH_PUBLIC_ORIGIN: publicOrigin, ADMIN_SITE_URL: adminOrigin,
    ADMIN_ALLOWED_USER_IDS: `${owner},${cofounder}`, GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret",
    AUTH_ALLOWED_EMAILS: "", ALLOW_PUBLIC_SIGNUP: false, ENABLE_AREA_SUMMARIES: true,
    AI_PROVIDER: "openai", OPENAI_API_KEY: "fixture-only", ENABLE_TRAFFIC_ANALYTICS: false,
  };
  const runtime = policyRuntime({
    "@/lib/env": { env: environment, isDatabaseConfigured: true },
    "@/lib/db/server": { database: () => db, writeTransaction: <T>(work: Parameters<typeof transaction<T>>[1]) => transaction(db, work) },
    ...dependencies,
  }, globals);
  function cookie(userId = owner, audience: "public" | "admin" = "public", expiresAt = Date.now() + 3600_000) {
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions(token_hash,user_id,audience,expires_at,created_at) VALUES (?,?,?,?,?)")
      .run(createHash("sha256").update(token).digest("hex"), userId, audience, expiresAt, Date.now());
    return `__Host-clamp-${audience}-session=${token}`;
  }
  function request(route: string, options: RequestInit = {}, userId = owner, audience: "public" | "admin" = "public") {
    const origin = audience === "public" ? publicOrigin : adminOrigin;
    const headers = new Headers(options.headers);
    headers.set("cookie", cookie(userId, audience));
    headers.set("origin", origin);
    return new Request(`${origin}${route}`, { ...options, headers });
  }
  function report(options: { id?: string; location?: string; status?: "pending" | "published" | "rejected"; text?: string; photo?: string; user?: string } = {}) {
    const id = options.id ?? randomUUID();
    const status = options.status ?? "published";
    db.prepare(`INSERT INTO reports(id,location_id,user_id,reporter_type,has_image,image_url,description,description_raw,
      moderation_status,reviewed_at) VALUES (?,?,?,'witness',?,?,?,?,?,?)`).run(
      id, options.location ?? locationId, options.user ?? owner, Number(Boolean(options.photo)), options.photo ?? null,
      options.text ?? "Parking permits are mentioned.", "PRIVATE ORIGINAL", status, status === "published" ? new Date().toISOString() : null);
    return id;
  }
  return { ...runtime, db, env: environment, cookie, request, report };
}

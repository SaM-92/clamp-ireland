// Dev-only helper: mints a working admin session directly in the database,
// bypassing Google OAuth. Real admin sign-in always goes through Google (see
// src/modules/auth/server/session.ts), but that requires a working
// GOOGLE_CLIENT_SECRET, which is NOT recoverable once lost (Azure Container
// Apps secrets are write-only). This script lets a developer preview the
// admin/moderator UI locally against a real Azure SQL dev database without
// needing that secret.
//
// It creates two placeholder admin profiles (the schema requires *exactly*
// two distinct admin UUIDs in ADMIN_ALLOWED_USER_IDS - see
// src/modules/auth/lib/adminPolicy.ts), signs a real 1-hour admin session for
// the first one, and prints everything needed to use it:
//   1. The ADMIN_ALLOWED_USER_IDS value to put in apps/admin/.env.local
//   2. The cookie name/value to add via browser DevTools > Application >
//      Cookies for http://localhost:3003 (the admin app's own origin)
//
// Usage: node --env-file-if-exists=.env.local scripts/dev/local-admin-session.mjs
// Never run this against a production database/config.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { openDatabase, closeDatabase, transaction } from "../../database/sql-store.mjs";

const server = process.env.AZURE_SQL_SERVER;
const databaseName = process.env.AZURE_SQL_DATABASE;
if (!server || !databaseName) throw new Error("Set AZURE_SQL_SERVER and AZURE_SQL_DATABASE first.");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to run against a production NODE_ENV.");

const config = {
  server, database: databaseName,
  port: process.env.AZURE_SQL_PORT ? Number(process.env.AZURE_SQL_PORT) : undefined,
  authMode: process.env.AZURE_SQL_AUTH_MODE === "sql" ? "sql" : "entra",
  production: false,
  clientId: process.env.AZURE_CLIENT_ID || undefined,
  user: process.env.AZURE_SQL_USER || undefined,
  password: process.env.AZURE_SQL_PASSWORD || undefined,
};

const pool = await openDatabase(config);
try {
  const primaryId = randomUUID();
  const reservedId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  const oneHourMs = 3600 * 1000;

  await transaction(pool, async (tx) => {
    for (const [id, label] of [[primaryId, "primary"], [reservedId, "reserved"]]) {
      await tx.prepare(
        "INSERT INTO profiles(id,google_subject,email,created_at,is_admin,is_banned) VALUES (?,?,?,?,1,0)",
      ).run(id, `local-dev-admin-${label}`, `local-dev-admin-${label}@example.invalid`, new Date(now).toISOString());
    }
    await tx.prepare(
      "INSERT INTO sessions(token_hash,user_id,audience,expires_at,created_at) VALUES (?,?,?,?,?)",
    ).run(tokenHash, primaryId, "admin", now + oneHourMs, now);
  });

  console.log("Local admin session created (expires in 1 hour).\n");
  console.log("1. Set this in apps/admin/.env.local:");
  console.log(`   ADMIN_ALLOWED_USER_IDS=${primaryId},${reservedId}\n`);
  console.log("2. Restart `npm run dev:admin`, then in your browser at http://localhost:3003:");
  console.log("   DevTools > Application > Cookies > localhost:3003 > add a cookie:");
  console.log("     name:  clamp-admin-session");
  console.log(`     value: ${token}`);
  console.log("     (leave HttpOnly/Secure checkboxes as DevTools defaults, Path=/)\n");
  console.log("3. Reload the page - you should land on the moderator dashboard.\n");
  console.log(`Profile IDs (for cleanup later): ${primaryId} (primary), ${reservedId} (reserved, unused).`);
} finally {
  await closeDatabase(config);
}

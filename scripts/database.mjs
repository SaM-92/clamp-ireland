import { openDatabase, closeDatabase, transaction, database as adapt } from "../database/sql-store.mjs";

const [command, ...args] = process.argv.slice(2);
const usage = "Use init, accounts, or admins <UUID> [second UUID]. "
  + "Azure SQL Database backs up automatically (point-in-time restore, no admin action needed); "
  + "to restore, use `az sql db restore` or the Azure Portal, then update AZURE_SQL_DATABASE. "
  + "This CLI has no backup/restore verbs - Azure SQL Database does not support T-SQL BACKUP/RESTORE.";

if (command === "backup" || command === "restore") throw new Error(usage);
if (!["init", "accounts", "admins"].includes(command)) throw new Error(usage);

const server = process.env.AZURE_SQL_SERVER;
const databaseName = process.env.AZURE_SQL_DATABASE;
if (!server || !databaseName) throw new Error("Set AZURE_SQL_SERVER and AZURE_SQL_DATABASE.");
const config = {
  server, database: databaseName, port: process.env.AZURE_SQL_PORT ? Number(process.env.AZURE_SQL_PORT) : undefined,
  authMode: process.env.AZURE_SQL_AUTH_MODE === "sql" ? "sql" : "entra",
  production: process.env.NODE_ENV === "production",
  clientId: process.env.AZURE_CLIENT_ID || undefined,
  user: process.env.AZURE_SQL_USER || undefined,
  password: process.env.AZURE_SQL_PASSWORD || undefined,
};

// openDatabase() applies every pending migration on connect, so `init` needs
// no separate step beyond opening the pool once.
const pool = await openDatabase(config);
try {
  const db = adapt(pool);
  if (command === "accounts") {
    console.table(await db.prepare("SELECT id,display_name,is_admin,is_banned FROM profiles ORDER BY created_at,id").all());
  } else if (command === "admins") {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (args.length < 1 || args.length > 2 || new Set(args).size !== args.length || args.some((id) => !uuid.test(id))) throw new Error("One or two distinct existing account UUIDs are required.");
    await transaction(pool, async (tx) => {
      for (const id of args) {
        if (!(await tx.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(id))) throw new Error("Every account must first sign in with Google and must not be banned.");
      }
      await tx.prepare("UPDATE profiles SET is_admin=0").run();
      for (const id of args) await tx.prepare("UPDATE profiles SET is_admin=1 WHERE id=?").run(id);
      await tx.prepare("DELETE FROM sessions WHERE audience='admin'").run();
    });
    console.log(`${args.length === 2 ? "Two admin roles" : "One admin role"} assigned; prior admin sessions revoked. Set ADMIN_ALLOWED_USER_IDS privately to ${args.length === 2 ? "these same two UUIDs" : "this same UUID"}.`);
  } else console.log("Azure SQL schema ready (migrations applied). No accounts or sample reports were inserted.");
} finally { await closeDatabase(config); }

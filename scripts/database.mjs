import path from "node:path";
import { existsSync } from "node:fs";
import { openDatabase, backupDatabase, transaction } from "../database/store.mjs";

const [command, ...args] = process.argv.slice(2);
const filename = process.env.DATABASE_PATH;
if (!filename || !path.isAbsolute(filename)) throw new Error("Set DATABASE_PATH to an absolute persistent local-disk path.");
if (command === "restore") {
  const [source] = args;
  if (!source || !path.isAbsolute(source) || !existsSync(source)) throw new Error("Provide an existing absolute backup path.");
  if ([filename, `${filename}-wal`, `${filename}-shm`].some(existsSync)) {
    throw new Error("Restore requires a new database path with no WAL/SHM files. Stop both apps, restore to a new path, then update DATABASE_PATH.");
  }
  const db = openDatabase(source);
  try { await backupDatabase(db, filename); }
  finally { db.close(); }
  const restored = openDatabase(filename);
  try { transaction(restored, () => restored.exec("DELETE FROM sessions; DELETE FROM oauth_attempts;")); }
  finally { restored.close(); }
  console.log("Restored and verified; sessions revoked. Review post-backup bans/takedowns before reopening both websites.");
} else {
  if (!["init", "backup", "accounts", "admins"].includes(command)) throw new Error("Use init, accounts, backup <new absolute path>, restore <backup path>, or admins <first UUID> <second UUID>.");
  if (command !== "init" && !existsSync(filename)) throw new Error("The source database does not exist. Only init may create a new empty database.");
  const db = openDatabase(filename);
  try {
    if (command === "backup") {
      await backupDatabase(db, args[0]);
      console.log("Consistent SQLite backup created and verified.");
    } else if (command === "accounts") {
      console.table(db.prepare("SELECT id,display_name,is_admin,is_banned FROM profiles ORDER BY created_at,id").all());
    } else if (command === "admins") {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (args.length !== 2 || args[0] === args[1] || args.some((id) => !uuid.test(id))) throw new Error("Exactly two distinct existing account UUIDs are required.");
      transaction(db, () => {
        for (const id of args) {
          if (!db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(id)) throw new Error("Both accounts must first sign in with Google and must not be banned.");
        }
        db.prepare("UPDATE profiles SET is_admin=0").run();
        for (const id of args) db.prepare("UPDATE profiles SET is_admin=1 WHERE id=?").run(id);
        db.prepare("DELETE FROM sessions WHERE audience='admin'").run();
      });
      console.log("Two admin roles assigned; prior admin sessions revoked. Set ADMIN_ALLOWED_USER_IDS privately to these same two UUIDs.");
    } else console.log("SQLite schema ready. No accounts or sample reports were inserted.");
  } finally { db.close(); }
}

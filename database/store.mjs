import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import geodesic from "geographiclib-geodesic";
import { migrations } from "./schema.mjs";

const applicationId = 1129074000;

export function distanceMetres(lat, lng, otherLat, otherLng) {
  if (![lat, lng, otherLat, otherLng].every(Number.isFinite) ||
      Math.abs(lat) > 90 || Math.abs(otherLat) > 90 || Math.abs(lng) > 180 || Math.abs(otherLng) > 180) {
    throw new Error("Invalid geographic coordinates.");
  }
  return geodesic.Geodesic.WGS84.Inverse(lat, lng, otherLat, otherLng).s12;
}

export function validSummary(value) {
  return typeof value === "string" && value.length >= 18 && value.length <= 160
    && value.trim().split(/\s+/u).length <= 20 && /^Reports mention [^.!?\r\n]+\.$/.test(value)
    && !/[\u0000-\u001f\u007f<>@]|https?:|www\./i.test(value);
}

export function openDatabase(filename) {
  if (filename !== ":memory:" && !path.isAbsolute(filename)) throw new Error("DATABASE_PATH must be absolute.");
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { allowExtension: false, enableForeignKeyConstraints: true });
  try {
    db.function("distance_m", { deterministic: true }, distanceMetres);
    db.function("valid_summary", { deterministic: true }, (value) => Number(validSummary(value)));
    db.exec("PRAGMA busy_timeout=5000;");
    const id = db.prepare("PRAGMA application_id").get().application_id;
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const tables = db.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().total;
    if ((id !== applicationId && (id !== 0 || tables !== 0 || version !== 0)) || version > migrations.length) {
      throw new Error("Refusing an unrecognized or newer database. Nothing was migrated.");
    }
    if (filename !== ":memory:") chmodSync(filename, 0o600);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    transaction(db, () => {
      // Re-read after the write lock: both websites may initialize concurrently.
      const current = db.prepare("PRAGMA user_version").get().user_version;
      for (let index = current; index < migrations.length; index++) {
        db.exec(migrations[index]);
        db.exec(`PRAGMA user_version=${index + 1};`);
      }
      db.exec(`PRAGMA application_id=${applicationId};`);
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work(db);
    if (result && typeof result.then === "function") throw new Error("SQLite transaction callbacks must be synchronous.");
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], "Could not confirm SQLite rollback."); }
    throw error;
  }
}

export async function backupDatabase(db, destination) {
  if (typeof destination !== "string" || !path.isAbsolute(destination) || existsSync(destination)) throw new Error("Backup requires a new absolute destination; existing files are never overwritten.");
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  await backup(db, destination);
  const copy = openDatabase(destination);
  try {
    if (copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
        copy.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Backup verification failed.");
  } finally { copy.close(); }
}

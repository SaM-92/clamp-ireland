import { expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, transaction, backupDatabase } from "../database/store.mjs";

function runCli(filename: string, ...args: string[]) {
  return spawnSync(process.execPath, ["scripts/database.mjs", ...args], {
    env: { ...process.env, DATABASE_PATH: filename }, encoding: "utf8",
  });
}

test("CLI backup/restore preserves data, revokes restored credentials and refuses unsafe paths", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "clamp-cli-restore-"));
  const filename = path.join(directory, "live.sqlite");
  const backup = path.join(directory, "backup.sqlite");
  const restoredFile = path.join(directory, "restored.sqlite");
  const missing = path.join(directory, "missing.sqlite");
  try {
    for (const command of ["accounts", "admins", "backup"]) {
      const result = runCli(missing, command, backup);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("source database does not exist");
      expect(existsSync(missing)).toBe(false);
    }
    expect(runCli(filename, "init").status).toBe(0);
    const db = openDatabase(filename);
    try {
      db.exec("INSERT INTO profiles(id,google_subject,email) VALUES ('fixture-account','fixture-subject','private@fixture.invalid')");
      for (const audience of ["public", "admin"]) {
        db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?)").run(audience, "fixture-account", audience, Date.now() + 60_000, Date.now());
      }
      db.prepare("INSERT INTO oauth_attempts VALUES (?,?,?,?,?,?)").run("fixture-flow", "public", "state", "nonce", "verifier", Date.now() + 60_000);
      db.exec("INSERT INTO locations(id,lat,lng) VALUES ('fixture-location',53.3,-6.2)");
    } finally { db.close(); }
    expect(runCli(filename, "backup", backup).status).toBe(0);
    expect(runCli(filename, "backup", backup).status).not.toBe(0);
    expect(runCli(filename, "restore", backup).stderr).toContain("requires a new database path");
    expect(runCli(restoredFile, "restore", missing).status).not.toBe(0);
    expect(existsSync(restoredFile)).toBe(false);
    const restore = runCli(restoredFile, "restore", backup);
    expect(restore.status, restore.stderr).toBe(0);
    expect(restore.stdout).toContain("sessions revoked");
    const restored = openDatabase(restoredFile);
    const source = openDatabase(backup);
    try {
      expect(restored.prepare("SELECT count(*) AS n FROM sessions").get()?.n).toBe(0);
      expect(restored.prepare("SELECT count(*) AS n FROM oauth_attempts").get()?.n).toBe(0);
      expect(source.prepare("SELECT count(*) AS n FROM sessions").get()?.n).toBe(2);
      for (const table of ["profiles", "locations"]) {
        expect(restored.prepare(`SELECT * FROM ${table}`).all()).toEqual(source.prepare(`SELECT * FROM ${table}`).all());
      }
    } finally { restored.close(); source.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI admin assignment is exactly-two, atomic and revokes only admin sessions", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "clamp-cli-admins-"));
  const filename = path.join(directory, "live.sqlite");
  const ids = [1, 2, 3].map((value) => `10000000-0000-4000-8000-00000000000${value}`);
  const db = openDatabase(filename);
  try {
    for (const id of ids) {
      db.prepare("INSERT INTO profiles(id,google_subject,email,is_admin) VALUES (?,?,?,1)").run(id, `subject-${id}`, `${id}@fixture.invalid`);
    }
    for (const audience of ["public", "admin"]) {
      db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?)").run(audience, ids[0], audience, Date.now() + 60_000, Date.now());
    }
    expect(runCli(filename, "admins", ids[0], ids[0]).status).not.toBe(0);
    expect(runCli(filename, "admins", ...ids).status).not.toBe(0);
    db.prepare("UPDATE profiles SET is_banned=1 WHERE id=?").run(ids[1]);
    expect(runCli(filename, "admins", ids[0], ids[1]).status).not.toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM profiles WHERE is_admin=1").get()?.n).toBe(3);
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()?.n).toBe(2);
    db.prepare("UPDATE profiles SET is_banned=0 WHERE id=?").run(ids[1]);
    const grant = runCli(filename, "admins", ids[0], ids[1]);
    expect(grant.status, grant.stderr).toBe(0);
    expect(db.prepare("SELECT id FROM profiles WHERE is_admin=1 ORDER BY id").all()).toEqual(ids.slice(0, 2).map((id) => ({ id })));
    expect(db.prepare("SELECT audience FROM sessions").all()).toEqual([{ audience: "public" }]);
    const listing = runCli(filename, "accounts");
    expect(listing.status).toBe(0);
    expect(listing.stdout).toContain(ids[0]);
    expect(listing.stdout).not.toContain("@fixture.invalid");
    expect(listing.stdout).not.toContain("subject-");
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("local file survives independent connections/restart; rollback and online backup preserve consistency", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "clamp-sqlite-"));
  const filename = path.join(directory, "live.sqlite");
  const backup = path.join(directory, "backup.sqlite");
  let db = openDatabase(filename);
  try {
    db.prepare("INSERT INTO locations(id,lat,lng) VALUES ('fixture-location',53.3,-6.2)").run();
    expect(() => transaction(db, () => {
      db.prepare("DELETE FROM locations").run();
      throw new Error("Abort");
    })).toThrow("Abort");
    expect(db.prepare("SELECT count(*) AS total FROM locations").get()?.total).toBe(1);
    expect(() => transaction(db, () => Promise.resolve())).toThrow("synchronous");
    await backupDatabase(db, backup);
    await expect(backupDatabase(db, backup)).rejects.toThrow("never overwritten");
    db.close();
    db = openDatabase(filename);
    expect(db.prepare("SELECT count(*) AS total FROM locations").get()?.total).toBe(1);
    const restored = openDatabase(backup);
    try {
      expect(restored.prepare("SELECT * FROM locations").all()).toEqual(db.prepare("SELECT * FROM locations").all());
      expect(restored.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
      expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { restored.close(); }
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("separate writers share one WAL file without lost increments or initialization races", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "clamp-concurrency-"));
  const filename = path.join(directory, "shared.sqlite");
  try {
    const program = `
      const { workerData } = require('node:worker_threads');
      const {openDatabase,transaction}=require(${JSON.stringify(path.resolve("database/store.mjs"))});
      const db=openDatabase(workerData);
      for(let i=0;i<50;i++) transaction(db,()=>db.prepare(
        "INSERT INTO traffic_daily VALUES ('2026-09-22','/','mobile',1) ON CONFLICT(day,route,viewport) DO UPDATE SET pageviews=pageviews+1"
      ).run());
      db.close();
    `;
    await Promise.all(Array.from({ length: 3 }, () => new Promise<void>((resolve, reject) => {
      const worker = new Worker(program, { eval: true, workerData: filename });
      worker.once("error", reject);
      worker.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Writer exited ${code}`)));
    })));
    const db = openDatabase(filename);
    try { expect(db.prepare("SELECT pageviews FROM traffic_daily").get()?.pageviews).toBe(150); }
    finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("relative, unrelated and future-schema databases are refused without adopting them", () => {
  expect(() => openDatabase("relative.sqlite")).toThrow("absolute");
  const directory = mkdtempSync(path.join(tmpdir(), "clamp-schema-"));
  const filename = path.join(directory, "foreign.sqlite");
  const newer = path.join(directory, "newer.sqlite");
  try {
    const foreign = new DatabaseSync(filename);
    foreign.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserve')");
    foreign.close();
    expect(() => openDatabase(filename)).toThrow("unrecognized");
    const check = new DatabaseSync(filename);
    try {
      expect(check.prepare("SELECT value FROM unrelated").get()?.value).toBe("preserve");
      expect(check.prepare("PRAGMA application_id").get()?.application_id).toBe(0);
    } finally { check.close(); }
    const next = openDatabase(newer);
    next.exec("PRAGMA user_version=999");
    next.close();
    expect(() => openDatabase(newer)).toThrow("newer");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

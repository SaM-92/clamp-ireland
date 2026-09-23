import "server-only";
import path from "node:path";
import { env } from "@/lib/env";
import { openDatabase, transaction } from "../../../database/store.mjs";
import type { DatabaseSync } from "node:sqlite";

let connection: DatabaseSync | undefined;
export function database(): DatabaseSync {
  if (!env.DATABASE_PATH || !path.isAbsolute(env.DATABASE_PATH)) {
    throw new Error("Set DATABASE_PATH to an absolute path on persistent local storage.");
  }
  connection ??= openDatabase(env.DATABASE_PATH);
  return connection;
}

export function writeTransaction<T>(work: (db: DatabaseSync) => T): T {
  return transaction(database(), work);
}

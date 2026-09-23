import type { ConnectionPool } from "mssql";

export interface SqlStatement<T> {
  get(...args: unknown[]): Promise<T | undefined>;
  all(...args: unknown[]): Promise<T[]>;
  run(...args: unknown[]): Promise<{ changes: number }>;
}
export interface SqlConnection {
  prepare<T = Record<string, unknown>>(text: string): SqlStatement<T>;
  /** Test-only escape hatch for raw DDL/multi-row batches. */
  exec(text: string): Promise<void>;
}
export interface AzureSqlConfig {
  server: string;
  database: string;
  authMode: "entra" | "sql";
  production: boolean;
  clientId?: string;
  user?: string;
  password?: string;
  port?: number;
}
export function openDatabase(config: AzureSqlConfig): Promise<ConnectionPool>;
/** Test-only: closes and forgets a cached pool so its throwaway database can be dropped. */
export function closeDatabase(config: AzureSqlConfig): Promise<void>;
export function database(current: ConnectionPool): SqlConnection;
export function transaction<T>(pool: ConnectionPool, work: (db: SqlConnection) => Promise<T>): Promise<T>;
export function distanceMetres(lat: number, lng: number, otherLat: number, otherLng: number): number;
export function validSummary(value: unknown): boolean;
export function boundingBox(lat: number, lng: number, marginMetres: number): { minLat: number; maxLat: number; minLng: number; maxLng: number };

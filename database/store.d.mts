import type { DatabaseSync } from "node:sqlite";
export function openDatabase(filename: string): DatabaseSync;
export function transaction<T>(db: DatabaseSync, work: (db: DatabaseSync) => T): T;
export function backupDatabase(db: DatabaseSync, destination: string): Promise<void>;
export function distanceMetres(lat: number, lng: number, otherLat: number, otherLng: number): number;
export function validSummary(value: unknown): boolean;

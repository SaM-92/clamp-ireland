import "server-only";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DEMO_REQUEST_LIMIT } from "../samples";

const directory = path.join(process.cwd(), ".local");
const counterPath = path.join(directory, "ai-demo-budget.json");
const lockPath = path.join(directory, "ai-demo-budget.lock");
const schema = z.strictObject({ used: z.number().int().min(0).max(DEMO_REQUEST_LIMIT) });

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readUsed(): Promise<number> {
  try {
    return schema.parse(JSON.parse(await readFile(counterPath, "utf8"))).used;
  } catch (error) {
    if (isMissing(error)) return 0;
    throw new Error("The local AI budget could not be verified. No inference is allowed.");
  }
}

export async function remainingDemoRequests(): Promise<number> {
  return DEMO_REQUEST_LIMIT - await readUsed();
}

export async function reserveDemoRequest(): Promise<number> {
  await mkdir(directory, { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch {
    throw new Error("The local AI budget is busy or locked. No inference was started.");
  }
  try {
    const used = await readUsed();
    if (used >= DEMO_REQUEST_LIMIT) throw new Error("The approved ten-request local demonstration budget is exhausted.");
    await writeFile(counterPath, JSON.stringify({ used: used + 1 }), { mode: 0o600 });
    return DEMO_REQUEST_LIMIT - used - 1;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

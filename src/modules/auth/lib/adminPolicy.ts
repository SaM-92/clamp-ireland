import { z } from "zod";

const idsSchema = z.array(z.uuid()).length(2).refine((ids) => new Set(ids).size === 2);

export function parseAdminIds(value: string | undefined): string[] | null {
  const result = idsSchema.safeParse((value ?? "").split(",").map((id) => id.trim()));
  return result.success ? result.data : null;
}

export function parseAdminOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

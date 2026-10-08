import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "./db/knowledge-store";
import { rateLimits } from "./db/schema";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current hour's window ends. */
  retryAfterSeconds: number;
}

const HOUR_MS = 3_600_000;

/**
 * Questions per visitor per clock hour.
 *
 * With a database the count is shared by every server instance; without one it falls back to this
 * instance's memory, which slows abuse rather than capping it. The address is stored only as a hash
 * with its hour, and the daily cron deletes rows older than a day.
 */
export async function consumeRateLimit(db: Db | undefined, address: string, limit: number, now = new Date()): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const retryAfterSeconds = Math.ceil((windowStart.getTime() + HOUR_MS - now.getTime()) / 1000);
  const key = createHash("sha256").update(`${address}|${windowStart.toISOString()}`).digest("hex");

  let count: number;
  if (db) {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
      .returning({ count: rateLimits.count });
    count = row?.count ?? 1;
  } else {
    count = (memoryCounts.get(key) ?? 0) + 1;
    memoryCounts.set(key, count);
    if (memoryCounts.size > 10_000) memoryCounts.clear();
  }
  return { allowed: count <= limit, retryAfterSeconds };
}

const memoryCounts = new Map<string, number>();

export function resetMemoryRateLimits(): void {
  memoryCounts.clear();
}

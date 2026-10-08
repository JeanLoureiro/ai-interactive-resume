import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { getRetentionDays } from "@/lib/config";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { purgeExpired } from "@/lib/memory";

export const runtime = "nodejs";

/** Constant-time, so the secret cannot be guessed one character at a time from response timing. */
function hasValidSecret(request: Request): boolean {
  const secret = process.env["CRON_SECRET"];
  // No secret configured means nobody is allowed, not everybody.
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Daily maintenance, called by Vercel Cron (vercel.json) with `Authorization: Bearer $CRON_SECRET`:
 *
 * - a query, which keeps a free Supabase project from pausing after 7 idle days (harmless elsewhere);
 * - retention: conversations older than CONVERSATION_RETENTION_DAYS, unapproved visitor questions
 *   of the same age, and rate-limit rows older than a day are deleted.
 */
export async function GET(request: Request): Promise<Response> {
  if (!hasValidSecret(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return Response.json({ ok: true, database: "not configured" });
  }
  try {
    await getDb().execute(sql`select 1`);
    await purgeExpired(getDb(), getRetentionDays());
    return Response.json({ ok: true, database: "reachable" });
  } catch (error) {
    // Logged, and surfaced as a 503 so the failure shows up in Vercel's cron logs.
    console.error("daily maintenance failed:", error);
    return Response.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}

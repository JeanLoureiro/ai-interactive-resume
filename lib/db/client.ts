import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

/** Blank counts as unset, so a copied `.env` with `DATABASE_URL=` runs the JSON demo. */
export function getDatabaseUrl(): string | undefined {
  return process.env["DATABASE_URL"]?.trim() || undefined;
}

export function isDatabaseConfigured(): boolean {
  return getDatabaseUrl() !== undefined;
}

let db: ReturnType<typeof createDb> | undefined;

function createDb(url: string) {
  // Supabase's transaction pooler (the serverless URL) rejects two things a direct Postgres accepts:
  // prepared statements, and pipelined queries. prepare: false covers the first. max_pipeline: 1
  // covers the second — several queries in flight on one connection never complete there, so a page
  // that loads the dashboard with Promise.all runs until the function is killed. max: 1 keeps each
  // serverless instance to a single pooled connection. On a direct connection the same queries
  // still run, one at a time.
  return drizzle(
    postgres(url, {
      prepare: false,
      max: 1,
      // One query in flight. The published types omit this; the runtime reads it.
      max_pipeline: 1,
    } as postgres.Options<Record<string, never>>),
  );
}

/** One client per process. Throws when DATABASE_URL is unset; callers check first. */
export function getDb() {
  const url = getDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set. Add it to .env, then run `pnpm db:setup`.");
  db ??= createDb(url);
  return db;
}

/** Scripts call this so the process can exit; the app never closes its client. */
export async function closeDb(): Promise<void> {
  await db?.$client.end();
  db = undefined;
}

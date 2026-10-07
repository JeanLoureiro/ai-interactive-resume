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
  // prepare: false because Supabase's transaction pooler (the serverless-friendly URL) does not
  // support prepared statements; it costs nothing on a direct connection. max: 1 keeps each
  // serverless instance to a single pooled connection. That is enough while the only query is the
  // once-per-instance knowledge load; revisit when per-request queries arrive (conversations).
  return drizzle(postgres(url, { prepare: false, max: 1 }));
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

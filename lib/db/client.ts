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
  // Use Supabase's session pooler (port 5432), not the transaction pooler (port 6543). Through the
  // transaction pooler, concurrent queries on one connection (the Promise.all in /api/status and
  // /admin) leave it hung until the function is killed, and limiting postgres.js to one query in
  // flight does not prevent it. prepare: false keeps a transaction-pooler URL from failing outright.
  // max: 1 keeps each serverless instance to a single pooled connection.
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

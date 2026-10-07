/**
 * Applies the SQL migrations in drizzle/ to DATABASE_URL. Run by `pnpm db:setup` before ingest.
 *
 * Migrations are generated with `pnpm db:generate` and committed, so every schema change is a
 * reviewed SQL file rather than something the app does to a database on startup.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../lib/db/client";

async function main(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: "drizzle" });
  console.log("Database schema is up to date.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);

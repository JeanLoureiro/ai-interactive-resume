import rawUnits from "../../data/knowledge-units.json" with { type: "json" };
import rawConflicts from "../../data/conflicts.json" with { type: "json" };
import { asc } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { KnowledgeStore } from "../knowledge";
import type { Conflict, KnowledgeUnit } from "../models";
import { getDb, isDatabaseConfigured } from "./client";
import { conflicts as conflictsTable, knowledgeUnits } from "./schema";

/** Any Drizzle Postgres database: postgres-js in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT>;

/** The committed snapshot. Read-only: used when no database is configured. */
export const jsonKnowledgeStore: KnowledgeStore = {
  name: "json-snapshot",
  async load() {
    return { units: rawUnits, conflicts: rawConflicts };
  },
};

/** SQL NULL becomes an absent key, because the Zod schema models "not stated" as optional. */
function withoutNulls(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key, value]) => value !== null && key !== "position"));
}

/** Postgres "undefined_table": the schema was never migrated. */
function isMissingTable(error: unknown): boolean {
  const codeOf = (value: unknown) => (value as { code?: unknown } | null)?.code;
  return codeOf(error) === "42P01" || codeOf((error as { cause?: unknown } | null)?.cause) === "42P01";
}

export function createPostgresKnowledgeStore(db: Db): KnowledgeStore {
  return {
    name: "postgres",
    async load() {
      try {
        const [units, conflicts] = await Promise.all([
          db.select().from(knowledgeUnits).orderBy(asc(knowledgeUnits.position)),
          db.select().from(conflictsTable).orderBy(asc(conflictsTable.position)),
        ]);
        return { units: units.map(withoutNulls), conflicts: conflicts.map(withoutNulls) };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new Error("The knowledge tables do not exist yet. Run `pnpm db:setup`.", { cause: error });
        }
        throw error;
      }
    },
  };
}

/**
 * Replaces the whole knowledge base in one transaction.
 *
 * Delete-then-insert inside BEGIN/COMMIT: if anything fails, the previous knowledge base is still
 * there, whole. A half-written one would look like the assistant forgetting things.
 */
export async function replaceKnowledge(db: Db, units: KnowledgeUnit[], conflicts: Conflict[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(conflictsTable);
    await tx.delete(knowledgeUnits);
    if (units.length > 0) {
      await tx.insert(knowledgeUnits).values(
        units.map((unit, position) => ({
          ...unit,
          employer: unit.employer ?? null,
          dateStart: unit.dateStart ?? null,
          dateEnd: unit.dateEnd ?? null,
          link: unit.link ?? null,
          position,
        })),
      );
    }
    if (conflicts.length > 0) {
      await tx.insert(conflictsTable).values(conflicts.map((conflict, position) => ({ ...conflict, position })));
    }
  });
}

let announced = false;

/** Postgres when DATABASE_URL is set, otherwise the committed snapshot as a read-only demo. */
export function getKnowledgeStore(): KnowledgeStore {
  if (isDatabaseConfigured()) return createPostgresKnowledgeStore(getDb());
  if (!announced) {
    console.info("DATABASE_URL is not set: serving the committed JSON snapshot (read-only demo).");
    announced = true;
  }
  return jsonKnowledgeStore;
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { buildKnowledgeBase } from "../lib/knowledge";
import {
  createPostgresKnowledgeStore,
  jsonKnowledgeStore,
  replaceKnowledge,
  type Db,
} from "../lib/db/knowledge-store";
import { retrieve } from "../lib/retrieval";

// Real Postgres, in-process (PGlite is Postgres compiled to WASM): the committed migrations and the
// store's SQL run for real, with no Docker or network.
async function freshDb(): Promise<Db> {
  const db = drizzle(new PGlite());
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as Db;
}

const snapshot = buildKnowledgeBase(await jsonKnowledgeStore.load());

describe("postgres knowledge store", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    await replaceKnowledge(db, snapshot.units, snapshot.conflicts);
  });

  it("round-trips the snapshot exactly, order included", async () => {
    const fromDb = buildKnowledgeBase(await createPostgresKnowledgeStore(db).load());
    expect(fromDb.units).toEqual(snapshot.units);
    expect(fromDb.conflicts).toEqual(snapshot.conflicts);
  });

  // The data moved; retrieval must not notice. Every eval question, compared field by field.
  it("retrieves identically to the snapshot for every eval question", async () => {
    const fromDb = buildKnowledgeBase(await createPostgresKnowledgeStore(db).load());
    const questions = readFileSync(path.join(process.cwd(), "eval", "dataset.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { question: string }).question);
    expect(questions.length).toBeGreaterThan(20);

    const summarise = (result: ReturnType<typeof retrieve>) => ({
      ranked: result.ranked.map(({ unit, score }) => [unit.id, score]),
      units: result.units.map((unit) => unit.id),
      conflicts: result.conflicts.map((conflict) => conflict.id),
    });
    for (const question of questions) {
      expect(summarise(retrieve(fromDb, question)), question).toEqual(summarise(retrieve(snapshot, question)));
    }
  });

  it("leaves the previous knowledge base whole when a replace fails", async () => {
    const duplicate = snapshot.units[0]!;
    await expect(replaceKnowledge(db, [duplicate, duplicate], [])).rejects.toThrow();
    const after = buildKnowledgeBase(await createPostgresKnowledgeStore(db).load());
    expect(after.units).toHaveLength(snapshot.units.length);
    expect(after.conflicts).toHaveLength(snapshot.conflicts.length);
  });
});

describe("unmigrated database", () => {
  it("says to run db:setup instead of surfacing a raw SQL error", async () => {
    const db = drizzle(new PGlite()) as unknown as Db;
    await expect(createPostgresKnowledgeStore(db).load()).rejects.toThrow(/pnpm db:setup/);
  });
});

import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Mirrors KnowledgeUnitSchema in lib/models.ts column for column.
 *
 * Kept deliberately plain (text, no enums): Zod remains the single place that decides what a valid
 * unit is, and every row is re-validated on load. A second, slightly different definition of
 * "valid" in the database would be two sources of truth for one rule.
 */
export const knowledgeUnits = pgTable("knowledge_units", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  unitType: text("unit_type").notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  employer: text("employer"),
  /** Verbatim from the source, never inferred. See KnowledgeUnitSchema. */
  dateStart: text("date_start"),
  dateEnd: text("date_end"),
  link: text("link"),
  retrievedAt: text("retrieved_at").notNull(),
  /** Ingest order. Postgres has no row order without ORDER BY, and BM25 breaks score ties by
   *  document order, so without this a tie could rank differently from the JSON snapshot. */
  position: integer("position").notNull(),
});

/** Mirrors ConflictSchema. */
export const conflicts = pgTable("conflicts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  unitIds: text("unit_ids").array().notNull(),
  resolutionNote: text("resolution_note").notNull(),
  /** File order; it decides the order disagreements appear in the prompt. */
  position: integer("position").notNull(),
});

/**
 * A resume uploaded in /admin, waiting for the owner to review and publish it.
 *
 * Holds the scrubbed units and the guard's report, never the uploaded file: the file is parsed in
 * memory and discarded, so the database cannot leak a phone number the resume contained.
 * One row at most; a new upload replaces it.
 */
export const knowledgeDrafts = pgTable("knowledge_drafts", {
  id: text("id").primaryKey(),
  units: jsonb("units").notNull(),
  report: jsonb("report").notNull(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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

/** One anonymous visitor conversation, identified only by a random id in an httpOnly cookie. */
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One question and the response the visitor saw. The full response is kept so the thread can be
 * shown again, sources included, after a reload. Deleted with its conversation after the retention
 * period (CONVERSATION_RETENTION_DAYS).
 */
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answerText: text("answer_text").notNull(),
    status: text("status").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId, table.createdAt)],
);

/**
 * Suggested questions. The owner's are approved when added; a visitor's question becomes a candidate
 * only when it was answered from sources, and is shown to others only after the owner approves it.
 */
export const suggestions = pgTable("suggestions", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  /** Lowercased, punctuation-free: "Where does Jean work now?" and "where does jean work now" are one. */
  normalized: text("normalized").notNull().unique(),
  origin: text("origin").notNull(),
  approved: boolean("approved").notNull().default(false),
  timesAsked: integer("times_asked").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Questions per visitor per hour. `key` is a hash of the visitor's address, never the address, and
 * rows are deleted within a day by the daily cron.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
);

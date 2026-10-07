import { eq } from "drizzle-orm";
import { buildKnowledgeBase } from "../knowledge";
import { KnowledgeUnitSchema, type KnowledgeUnit } from "../models";
import type { ResumeReport } from "../resume";
import { createPostgresKnowledgeStore, replaceKnowledge, type Db } from "../db/knowledge-store";
import { knowledgeDrafts } from "../db/schema";

const DRAFT_ID = "current";

export interface Draft {
  units: KnowledgeUnit[];
  report: ResumeReport;
  fileName: string;
  createdAt: Date;
}

/** Scrubbed units and the guard's report only. There is deliberately no column for the file. */
export async function saveDraft(db: Db, draft: Omit<Draft, "createdAt">): Promise<void> {
  const row = { id: DRAFT_ID, units: draft.units, report: draft.report, fileName: draft.fileName, createdAt: new Date() };
  await db.insert(knowledgeDrafts).values(row).onConflictDoUpdate({ target: knowledgeDrafts.id, set: row });
}

export async function getDraft(db: Db): Promise<Draft | undefined> {
  const [row] = await db.select().from(knowledgeDrafts).where(eq(knowledgeDrafts.id, DRAFT_ID));
  if (!row) return undefined;
  return {
    units: KnowledgeUnitSchema.array().parse(row.units),
    report: row.report as ResumeReport,
    fileName: row.fileName,
    createdAt: row.createdAt,
  };
}

export async function discardDraft(db: Db): Promise<void> {
  await db.delete(knowledgeDrafts).where(eq(knowledgeDrafts.id, DRAFT_ID));
}

export interface UnitDiff {
  added: KnowledgeUnit[];
  removed: KnowledgeUnit[];
  changed: Array<{ before: KnowledgeUnit; after: KnowledgeUnit }>;
  unchanged: number;
}

/** CV units only: an upload never touches LinkedIn or GitHub units. retrievedAt is ignored. */
export function diffCvUnits(live: KnowledgeUnit[], draft: KnowledgeUnit[]): UnitDiff {
  const comparable = ({ retrievedAt: _retrievedAt, ...rest }: KnowledgeUnit) => JSON.stringify(rest);
  const liveCv = new Map(live.filter((unit) => unit.source === "cv").map((unit) => [unit.id, unit]));
  const draftIds = new Set(draft.map((unit) => unit.id));
  const diff: UnitDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const after of draft) {
    const before = liveCv.get(after.id);
    if (!before) diff.added.push(after);
    else if (comparable(before) !== comparable(after)) diff.changed.push({ before, after });
    else diff.unchanged++;
  }
  for (const unit of liveCv.values()) if (!draftIds.has(unit.id)) diff.removed.push(unit);
  return diff;
}

/**
 * Makes the draft live: its CV units replace the current CV units, everything else is kept.
 *
 * Validated as a whole first, so a known conflict that points at a CV unit the new resume no longer
 * produces blocks the publish with its id, and the live knowledge base stays exactly as it was.
 */
export async function publishDraft(db: Db): Promise<{ units: number }> {
  const draft = await getDraft(db);
  if (!draft) throw new Error("There is no uploaded resume to publish.");
  const live = buildKnowledgeBase(await createPostgresKnowledgeStore(db).load());
  const kb = buildKnowledgeBase({
    units: [...draft.units, ...live.units.filter((unit) => unit.source !== "cv")],
    conflicts: live.conflicts,
  });
  await replaceKnowledge(db, kb.units, kb.conflicts);
  await discardDraft(db);
  return { units: kb.units.length };
}

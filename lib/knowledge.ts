import { ConflictSchema, KnowledgeUnitSchema, type Conflict, type KnowledgeUnit } from "./models";
import { getKnowledgeStore } from "./db/knowledge-store";

export interface KnowledgeBase {
  units: KnowledgeUnit[];
  conflicts: Conflict[];
  byId: Map<string, KnowledgeUnit>;
  /** unit id -> conflicts that unit is party to. Drives force-inclusion at retrieval time. */
  conflictsByUnitId: Map<string, Conflict[]>;
}

/** Raw records as a store returns them, before validation. */
export interface RawKnowledge {
  units: unknown[];
  conflicts: unknown[];
}

/**
 * Where the knowledge base comes from: Postgres when DATABASE_URL is set, the committed JSON
 * snapshot otherwise. Everything downstream sees the same validated KnowledgeBase either way.
 */
export interface KnowledgeStore {
  /** Shown in logs, so an operator can tell which store answered. */
  readonly name: string;
  load(): Promise<RawKnowledge>;
}

/**
 * Validates raw records and builds the lookup maps. Pure, so every store and every test goes
 * through exactly the same checks.
 */
export function buildKnowledgeBase(raw: RawKnowledge): KnowledgeBase {
  const units = KnowledgeUnitSchema.array().parse(raw.units);
  const conflicts = ConflictSchema.array().parse(raw.conflicts);

  const byId = new Map(units.map((unit) => [unit.id, unit]));

  // A conflict pointing at an id that no longer exists would never fire, and nothing would say so —
  // the system would quietly stop disclosing a known disagreement. Renaming a unit must break the
  // build, not degrade the answers.
  for (const conflict of conflicts) {
    const missing = conflict.unitIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Conflict "${conflict.id}" references unknown knowledge unit(s): ${missing.join(", ")}. ` +
          `Re-run \`pnpm ingest\` or update data/conflicts.json — a dangling reference silently disables the disclosure.`,
      );
    }
  }

  const conflictsByUnitId = new Map<string, Conflict[]>();
  for (const conflict of conflicts) {
    for (const id of conflict.unitIds) {
      const existing = conflictsByUnitId.get(id);
      if (existing) existing.push(conflict);
      else conflictsByUnitId.set(id, [conflict]);
    }
  }

  return { units, conflicts, byId, conflictsByUnitId };
}

let cached: Promise<KnowledgeBase> | undefined;

/**
 * Loaded and validated once per server instance; the corpus is static between ingests.
 *
 * The promise is cached, not the value, so concurrent first requests share one load. A failed load
 * is not cached: the next request retries instead of serving a broken instance forever.
 */
export function getKnowledgeBase(): Promise<KnowledgeBase> {
  cached ??= getKnowledgeStore()
    .load()
    .then(buildKnowledgeBase)
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  return cached;
}

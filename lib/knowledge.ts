import rawUnits from "../data/knowledge-units.json" with { type: "json" };
import rawConflicts from "../data/conflicts.json" with { type: "json" };
import { ConflictSchema, KnowledgeUnitSchema, type Conflict, type KnowledgeUnit } from "./models";

export interface KnowledgeBase {
  units: KnowledgeUnit[];
  conflicts: Conflict[];
  byId: Map<string, KnowledgeUnit>;
  /** unit id -> conflicts that unit is party to. Drives force-inclusion at retrieval time. */
  conflictsByUnitId: Map<string, Conflict[]>;
}

function build(): KnowledgeBase {
  const units = KnowledgeUnitSchema.array().parse(rawUnits);
  const conflicts = ConflictSchema.array().parse(rawConflicts);

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

let cached: KnowledgeBase | undefined;

/** Parsed and validated once per process; the corpus is static between ingests. */
export function getKnowledgeBase(): KnowledgeBase {
  cached ??= build();
  return cached;
}

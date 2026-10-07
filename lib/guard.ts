import type { Answer, KnowledgeUnit, ResolvedClaim } from "./models";

export interface GuardOutcome {
  ok: boolean;
  /** Cited ids that were not in the set supplied for this question. */
  invalidSourceIds: string[];
  /** Set when the answer asserted something with no citation at all. */
  uncited: boolean;
  claims: ResolvedClaim[];
}

/**
 * The enforcement point. Everything else in this system is a way of making the model likely to
 * behave; this is the part that does not depend on it behaving.
 *
 * WHAT THIS CATCHES
 *   - A citation to an id that was never supplied for this question — invented, misremembered, or a
 *     real unit the retriever did not return. Checking against *this turn's* retrieved set rather
 *     than the whole knowledge base is what makes the check worth running: "exists somewhere in the
 *     corpus" would pass almost anything.
 *   - An answer that asserts something while citing nothing.
 *
 * WHAT THIS DOES NOT CATCH
 *   Content-level fabrication: citing a unit that genuinely was supplied, while overstating what it
 *   says. "Built tax-calculation software" becoming "is a certified financial planner" cites a real,
 *   retrieved unit and passes every check here. Nothing mechanical in this codebase catches that.
 *   It is covered by the must-not-claim labels in the eval, graded by hand, and reported as a
 *   measured rate rather than a guarantee. See README and docs/evaluation.md — the limitation is
 *   stated there rather than left for a reader to discover.
 */
export function checkCitations(answer: Answer, retrieved: KnowledgeUnit[]): GuardOutcome {
  const available = new Map(retrieved.map((unit) => [unit.id, unit]));

  const invalid = new Set<string>();
  const claims: ResolvedClaim[] = answer.claims.map((claim) => {
    const sources: KnowledgeUnit[] = [];
    for (const id of claim.sourceIds) {
      const unit = available.get(id);
      if (unit) sources.push(unit);
      else invalid.add(id);
    }
    return { text: claim.text, sources };
  });

  // The model asserting sufficiency while citing nothing is an uncited answer, not a refusal. The
  // schema requires a non-empty sourceIds per claim but does not require any claims to exist, so
  // this is the case the schema cannot express.
  const uncited = answer.hasSufficientContext && answer.claims.length === 0;

  return {
    ok: invalid.size === 0 && !uncited,
    invalidSourceIds: [...invalid],
    uncited,
    claims,
  };
}

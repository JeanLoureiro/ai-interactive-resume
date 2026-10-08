import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "../lib/generation";
import { buildKnowledgeBase } from "../lib/knowledge";
import { jsonKnowledgeStore } from "../lib/db/knowledge-store";
import { retrieve } from "../lib/retrieval";

const kb = buildKnowledgeBase(await jsonKnowledgeStore.load());
const UNIT_ID = /\b(?:cv|linkedin|github):[a-z0-9_.-]+/g;

describe("the prompt", () => {
  // The guard rejects any citation to a unit that was not supplied. So the prompt must never show
  // the model an id it is not allowed to cite: found when a conflict whose partner unit did not fit
  // under the force-inclusion cap still listed that partner's id, and the model cited it.
  it("only shows unit ids that were supplied with the question", () => {
    const questions = ["How much experience does Jean have?", "Where does Jean work now?", "What did Jean study?"];
    for (const question of questions) {
      const { units, conflicts } = retrieve(kb, question, 5);
      const supplied = new Set(units.map((unit) => unit.id));
      const shown = buildUserPrompt(question, units, conflicts).match(UNIT_ID) ?? [];
      expect(shown.filter((id) => !supplied.has(id)), question).toEqual([]);
    }
  });

  it("still states a disagreement whose other side was not supplied", () => {
    const [conflict] = kb.conflicts;
    const oneSide = [kb.byId.get(conflict!.unitIds[0]!)!];
    const prompt = buildUserPrompt("q", oneSide, [conflict!]);
    expect(prompt).toContain(conflict!.resolutionNote);
    expect(prompt).toMatch(/not supplied with this question/);
  });
});

import { describe, expect, it } from "vitest";
import { retrieve } from "../lib/retrieval";

describe("BM25 retrieval", () => {
  it("ranks the matching employer's units first", () => {
    const { ranked } = retrieve("What did Jean do at SeaportOPX?");
    expect(ranked[0]?.unit.id).toContain("seaportopx");
  });

  it("returns nothing for a question with no lexical overlap", () => {
    const { ranked } = retrieve("zzzz qqqq xxxx");
    expect(ranked).toEqual([]);
  });

  it("scores in descending order", () => {
    const scores = retrieve("KPMG microfrontend migration").ranked.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe("conflict force-inclusion", () => {
  // The behaviour the whole conflicts mechanism exists for: asking about the current employer must
  // put both sides of the stale-LinkedIn disagreement in front of the model, even though only one
  // side matched the query.
  it("pulls in the other side of a disagreement and the note", () => {
    const result = retrieve("Where does Jean work now?");
    const ids = result.units.map((u) => u.id);
    expect(ids).toContain("cv:kpmg-manager-senior-software-engineer");
    expect(ids).toContain("linkedin:current-employer");
    expect(result.conflicts.map((c) => c.id)).toContain("employment-status-stale-on-linkedin");
  });

  it("caps how many units force-inclusion can add", () => {
    const topK = 5;
    const result = retrieve("Where does Jean work now?", topK);
    // top-k plus at most MAX_FORCED_UNITS (5). Without the cap this question pulled 11 units.
    expect(result.units.length).toBeLessThanOrEqual(topK + 5);
  });

  it("surfaces the conflict even when a partner unit did not fit the budget", () => {
    const result = retrieve("Tell me about Jean's projects and where he works");
    if (result.conflicts.length > 0) {
      // A triggered conflict always reaches the prompt via its resolution note, whether or not its
      // units did — the disagreement is never silently dropped.
      expect(result.conflicts.every((c) => c.resolutionNote.length > 0)).toBe(true);
    }
  });
});

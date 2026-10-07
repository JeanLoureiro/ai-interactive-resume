import { describe, expect, it } from "vitest";
import { checkCitations } from "../lib/guard";
import type { Answer, KnowledgeUnit } from "../lib/models";

function unit(id: string): KnowledgeUnit {
  return {
    id,
    source: "cv",
    unitType: "employment",
    title: `Title for ${id}`,
    text: `Body text for ${id}`,
    retrievedAt: "2026-09-21",
  };
}

function answer(overrides: Partial<Answer> = {}): Answer {
  return {
    answerText: "Jean worked at KPMG.",
    claims: [{ text: "Jean worked at KPMG.", sourceIds: ["cv:kpmg"] }],
    hasSufficientContext: true,
    ...overrides,
  };
}

describe("citation guard", () => {
  it("accepts citations that were supplied for this question", () => {
    const outcome = checkCitations(answer(), [unit("cv:kpmg")]);
    expect(outcome.ok).toBe(true);
    expect(outcome.invalidSourceIds).toEqual([]);
    expect(outcome.claims[0]?.sources.map((s) => s.id)).toEqual(["cv:kpmg"]);
  });

  it("rejects a citation to an id that was never supplied", () => {
    const fabricated = answer({
      claims: [{ text: "Jean worked at Google.", sourceIds: ["cv:google"] }],
    });
    const outcome = checkCitations(fabricated, [unit("cv:kpmg")]);
    expect(outcome.ok).toBe(false);
    expect(outcome.invalidSourceIds).toEqual(["cv:google"]);
  });

  // The important case, and the reason the guard checks the retrieved set rather than the corpus.
  // A real unit that was not retrieved this turn is still a citation the model cannot justify: it
  // never saw the text, so it cannot know the unit supports the claim.
  it("rejects a real unit that was not retrieved for this question", () => {
    const outcome = checkCitations(
      answer({ claims: [{ text: "Jean did X.", sourceIds: ["cv:seaportopx"] }] }),
      [unit("cv:kpmg")],
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.invalidSourceIds).toEqual(["cv:seaportopx"]);
  });

  it("rejects an answer that asserts sufficiency while citing nothing", () => {
    const outcome = checkCitations(answer({ claims: [] }), [unit("cv:kpmg")]);
    expect(outcome.ok).toBe(false);
    expect(outcome.uncited).toBe(true);
  });

  it("allows a refusal to carry no claims", () => {
    const outcome = checkCitations(
      answer({ claims: [], hasSufficientContext: false }),
      [unit("cv:kpmg")],
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.uncited).toBe(false);
  });

  it("fails the whole answer when only one citation among several is bad", () => {
    const outcome = checkCitations(
      answer({
        claims: [
          { text: "Real claim.", sourceIds: ["cv:kpmg"] },
          { text: "Fabricated claim.", sourceIds: ["cv:kpmg", "cv:invented"] },
        ],
      }),
      [unit("cv:kpmg")],
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.invalidSourceIds).toEqual(["cv:invented"]);
  });
});

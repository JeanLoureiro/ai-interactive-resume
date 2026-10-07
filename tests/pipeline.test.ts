import { describe, expect, it } from "vitest";
import { ask } from "../lib/pipeline";
import { GenerationError, type GenerationResult } from "../lib/generation";
import type { Answer, KnowledgeUnit } from "../lib/models";

/**
 * The generator is injected rather than module-mocked. These tests exist to prove the failure
 * branches behave — provider down, unparseable output, fabricated citation — and those are exactly
 * the cases that cannot be triggered against a live API on demand.
 */
function stub(
  answer: Partial<Answer>,
  usage: { inputTokens?: number; outputTokens?: number } = {},
) {
  return async (): Promise<GenerationResult> => ({
    answer: { answerText: "", claims: [], hasSufficientContext: true, ...answer },
    model: "claude-sonnet-5",
    inputTokens: usage.inputTokens ?? 1000,
    outputTokens: usage.outputTokens ?? 100,
  });
}

/** Cites whatever it was actually given, the way a well-behaved model would. */
const citesFirstRetrieved = async (
  _question: string,
  units: KnowledgeUnit[],
): Promise<GenerationResult> => ({
  answer: {
    answerText: "Jean led frontend architecture at KPMG.",
    claims: [{ text: "Jean led frontend architecture at KPMG.", sourceIds: [units[0]!.id] }],
    hasSufficientContext: true,
  },
  model: "claude-sonnet-5",
  inputTokens: 1000,
  outputTokens: 100,
});

const failsWith = (error: Error) => async (): Promise<GenerationResult> => {
  throw error;
};

const QUESTION = "What did Jean do at KPMG?";

describe("pipeline status routing", () => {
  it("returns answered when citations are valid", async () => {
    const response = await ask(QUESTION, { generateFn: citesFirstRetrieved });
    expect(response.status).toBe("answered");
    expect(response.claims[0]?.sources).toHaveLength(1);
    expect(response.answerText).toContain("KPMG");
  });

  it("rejects and replaces an answer that cites an unsupplied id", async () => {
    const response = await ask(QUESTION, {
      generateFn: stub({
        answerText: "Jean worked at Google for ten years.",
        claims: [{ text: "Jean worked at Google.", sourceIds: ["cv:google-fabricated"] }],
      }),
    });
    expect(response.status).toBe("guard_rejected");
    expect(response.diagnostics.invalidSourceIds).toEqual(["cv:google-fabricated"]);
    // The fabricated prose must not reach the user under any circumstances.
    expect(response.answerText).not.toContain("Google");
  });

  // The guard runs before the model's own sufficiency flag: a model that fabricated a citation has
  // already shown its self-report is untrustworthy this turn.
  it("prefers guard rejection over the model's sufficiency claim", async () => {
    const response = await ask(QUESTION, {
      generateFn: stub({
        answerText: "Something unsupported.",
        claims: [{ text: "Unsupported.", sourceIds: ["cv:nope"] }],
        hasSufficientContext: false,
      }),
    });
    expect(response.status).toBe("guard_rejected");
  });

  it("rejects an answer that asserts sufficiency while citing nothing", async () => {
    const response = await ask(QUESTION, {
      generateFn: stub({ answerText: "Jean is extremely senior.", claims: [] }),
    });
    expect(response.status).toBe("guard_rejected");
    expect(response.answerText).not.toContain("extremely senior");
  });

  it("returns insufficient_context when the model declines", async () => {
    const response = await ask("Does Jean have a pilot licence?", {
      generateFn: stub({ answerText: "The sources do not cover that.", hasSufficientContext: false }),
    });
    expect(response.status).toBe("insufficient_context");
    expect(response.answerText).toContain("do not cover");
  });

  it("degrades to a deterministic message when the provider fails", async () => {
    const response = await ask(QUESTION, {
      generateFn: failsWith(
        new GenerationError({ kind: "provider_unavailable", message: "connection reset" }),
      ),
    });
    expect(response.status).toBe("provider_error");
    // The raw provider message must not surface, and sources are still returned so a failure
    // leaves the user with something readable rather than a dead end.
    expect(response.answerText).not.toContain("connection reset");
    expect(response.retrieved.length).toBeGreaterThan(0);
  });

  it("treats unparseable model output as a failure, not an empty answer", async () => {
    const response = await ask(QUESTION, {
      generateFn: failsWith(
        new GenerationError({ kind: "unparseable", message: "no schema-valid output" }),
      ),
    });
    expect(response.status).toBe("provider_error");
  });

  it("lets an unexpected error surface instead of disguising it as a refusal", async () => {
    // A bug in our own code must not be reported to the user as "not in Jean's background".
    await expect(
      ask(QUESTION, { generateFn: failsWith(new TypeError("bug in our code")) }),
    ).rejects.toThrow("bug in our code");
  });

  it("reports real token usage and a computed cost", async () => {
    const { diagnostics } = await ask(QUESTION, { generateFn: citesFirstRetrieved });
    // 1000 in @ $2/MTok + 100 out @ $10/MTok = $0.003
    expect(diagnostics.costUsd).toBeCloseTo(0.003, 6);
    expect(diagnostics.inputTokens).toBe(1000);
    expect(diagnostics.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("never calls the model when retrieval finds nothing", async () => {
    let called = false;
    const response = await ask("zzzz qqqq xxxx", {
      generateFn: async () => {
        called = true;
        throw new Error("should not be reached");
      },
    });
    expect(called).toBe(false);
    expect(response.status).toBe("insufficient_context");
  });
});

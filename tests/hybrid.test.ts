import { describe, expect, it, vi } from "vitest";
import { semanticInput, type Embedder } from "../lib/embeddings";
import { buildKnowledgeBase } from "../lib/knowledge";
import type { KnowledgeUnit } from "../lib/models";
import { retrieve, type SemanticInput } from "../lib/retrieval";

const unit = (id: string, text: string): KnowledgeUnit => ({ id, source: "cv", unitType: "project", title: id, text, retrievedAt: "2026-10-08" });
const kb = buildKnowledgeBase({
  units: [
    unit("cv:kymchat", "Enterprise assistant on Azure OpenAI with token streaming."),
    unit("cv:poker", "Live poker platform built with a co-founder."),
    unit("cv:summary", "Shipping production software for fifteen years."),
  ],
  conflicts: [],
});

/** Unit vectors as one-hot directions, so the query vector picks exactly the similarity we want. */
const semantic = (similarities: number[], minSimilarity = 0.5): SemanticInput => ({
  units: kb.units.map((_, i) => Float32Array.from(kb.units.map((__, j) => (i === j ? 1 : 0)))),
  query: Float32Array.from(similarities),
  minSimilarity,
});

describe("hybrid retrieval", () => {
  it("finds a unit that shares no words with the question", () => {
    // "built" matches the poker unit for BM25; nothing about the question matches "assistant".
    const bm25 = retrieve(kb, "Has Jean built a chatbot?").ranked.map((r) => r.unit.id);
    expect(bm25).not.toContain("cv:kymchat");
    const hybrid = retrieve(kb, "Has Jean built a chatbot?", 5, semantic([0.9, 0.1, 0.1])).ranked.map((r) => r.unit.id);
    // Tied with poker under RRF (each is first in one ranking); ties keep BM25's order.
    expect(hybrid.slice(0, 2)).toEqual(["cv:poker", "cv:kymchat"]);
  });

  it("ranks a unit both rankings find above units only one of them finds", () => {
    // BM25 finds the summary ("shipping") and the poker unit ("poker"); meaning finds poker and kymchat.
    const ids = retrieve(kb, "poker and shipping", 5, semantic([0.7, 0.9, 0.1])).ranked.map((r) => r.unit.id);
    expect(ids[0]).toBe("cv:poker");
    expect(ids).toEqual(expect.arrayContaining(["cv:summary", "cv:kymchat"]));
  });

  it("ignores vector matches below the similarity floor, keeping the no-match refusal path", () => {
    // An off-topic question: BM25 finds nothing and every similarity is under the floor.
    expect(retrieve(kb, "What is the capital of France?", 5, semantic([0.4, 0.3, 0.45])).ranked).toEqual([]);
  });

  it("is BM25 alone without semantic input", () => {
    const withVectors = retrieve(kb, "poker platform", 5, semantic([0, 0, 0]));
    const without = retrieve(kb, "poker platform", 5);
    expect(withVectors.ranked.map((r) => r.unit.id)).toEqual(without.ranked.map((r) => r.unit.id));
  });
});

describe("embedding failure", () => {
  it("falls back to BM25 (undefined) and logs, instead of failing the question", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = async (): Promise<Embedder> => {
      throw new Error("model download failed");
    };
    expect(await semanticInput(kb, "anything", broken)).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/BM25 only/), expect.any(Error));
    error.mockRestore();
  });

  it("embeds the units once per knowledge base and prefixes the question", async () => {
    const calls: string[][] = [];
    const fake: Embedder = async (texts) => {
      calls.push(texts);
      return texts.map(() => new Float32Array([1, 0, 0]));
    };
    await semanticInput(kb, "first", async () => fake);
    await semanticInput(kb, "second", async () => fake);
    expect(calls.filter((texts) => texts.length === kb.units.length)).toHaveLength(1);
    expect(calls.at(-1)![0]).toMatch(/^Represent this sentence for searching relevant passages: second$/);
  });
});

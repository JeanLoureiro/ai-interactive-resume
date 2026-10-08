/**
 * Retrieval-only eval: recall@5 on every case with gold ids, per retrieval mode. The only model calls
 * are the follow-up rewrites (a handful of fast-model calls); everything else is local and free.
 *
 *   pnpm eval:retrieval
 *
 * Recall here is scored on the ranked top 5 only, before conflict force-inclusion, so it measures
 * the retriever rather than the conflicts data.
 */
import { buildKnowledgeBase } from "../lib/knowledge";
import { jsonKnowledgeStore } from "../lib/db/knowledge-store";
import { retrieve } from "../lib/retrieval";
import { EMBEDDING_MODEL, semanticInput } from "../lib/embeddings";
import { followUpQuery } from "../lib/conversation";
import { getFastModel } from "../lib/config";
import { getLlmProvider } from "../lib/llm";
import { loadDataset, type EvalCase } from "./dataset";

const TOP_K = 5;

type Mode = "bm25" | "hybrid";

async function rankedIds(mode: Mode, kb: ReturnType<typeof buildKnowledgeBase>, question: string): Promise<string[]> {
  switch (mode) {
    case "bm25":
      return retrieve(kb, question, TOP_K).ranked.map(({ unit }) => unit.id);
    case "hybrid": {
      const semantic = await semanticInput(kb, question);
      if (!semantic) throw new Error("The embedding model did not load; hybrid cannot be measured.");
      return retrieve(kb, question, TOP_K, semantic).ranked.map(({ unit }) => unit.id);
    }
  }
}

async function main(): Promise<void> {
  const kb = buildKnowledgeBase(await jsonKnowledgeStore.load());
  const cases = (await loadDataset()).filter((testCase) => testCase.goldSourceIds.length > 0);
  const modes: Mode[] = ["bm25", "hybrid"];
  console.log(`hybrid = BM25 + ${EMBEDDING_MODEL.id}, fused with RRF`);
  const found = new Map<Mode, Set<string>>();

  for (const mode of modes) {
    const hits = new Set<string>();
    const misses: EvalCase[] = [];
    for (const testCase of cases) {
      // Follow-ups are retrieved the way the app does it: rewritten into a standalone question by the
      // fast model (the only part of this eval that calls a model; a few cents of Haiku at most).
      const query = await followUpQuery(testCase.question, testCase.history ?? [], getLlmProvider, getFastModel());
      if (testCase.history?.length && mode === "hybrid") console.log(`  ${testCase.id} searched as: ${query.replace(/\n/g, " / ")}`);
      const ids = await rankedIds(mode, kb, query);
      if (testCase.goldSourceIds.some((id) => ids.includes(id))) hits.add(testCase.id);
      else misses.push(testCase);
    }
    found.set(mode, hits);

    const byCategory = new Map<string, [number, number]>();
    for (const testCase of cases) {
      const [hit, total] = byCategory.get(testCase.category) ?? [0, 0];
      byCategory.set(testCase.category, [hit + (hits.has(testCase.id) ? 1 : 0), total + 1]);
    }
    console.log(`\n${mode.toUpperCase()}  recall@${TOP_K}: ${hits.size}/${cases.length}`);
    for (const [category, [hit, total]] of byCategory) console.log(`  ${category.padEnd(13)} ${hit}/${total}`);
    for (const miss of misses) console.log(`  miss ${miss.id}: ${miss.question.slice(0, 80)}`);
  }

  const bm25 = found.get("bm25")!;
  const hybrid = found.get("hybrid")!;
  const paraphrase = cases.filter((testCase) => testCase.category === "paraphrase");
  const lost = [...bm25].filter((id) => !hybrid.has(id));
  const bars = [
    [`recall at least BM25's (${hybrid.size} vs ${bm25.size})`, hybrid.size >= bm25.size],
    [`at least 6 of 8 paraphrase cases (${paraphrase.filter((c) => hybrid.has(c.id)).length})`, paraphrase.filter((c) => hybrid.has(c.id)).length >= 6],
    [`no case BM25 finds is lost${lost.length ? ` (lost: ${lost.join(", ")})` : ""}`, lost.length === 0],
  ] as const;
  console.log("\nBARS FOR HYBRID AS DEFAULT");
  for (const [label, met] of bars) console.log(`  ${met ? "met " : "MISS"}  ${label}`);

  const followUps = cases.filter((c) => c.category === "follow_up");
  const followUpHits = followUps.filter((c) => hybrid.has(c.id)).length;
  console.log("\nBAR FOR CONVERSATION MEMORY");
  console.log(`  ${followUpHits >= 3 ? "met " : "MISS"}  hybrid finds at least 3 of ${followUps.length} follow-ups (${followUpHits})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

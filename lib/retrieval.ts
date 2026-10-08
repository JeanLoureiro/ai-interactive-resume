import type { KnowledgeBase } from "./knowledge";
import type { Conflict, KnowledgeUnit } from "./models";

/**
 * BM25, optionally fused with embedding similarity (hybrid retrieval).
 *
 * BM25 is strongest on the exact names interview questions are full of ("KPMG", "Storybook",
 * "Scrum"); embeddings find meaning when the words differ ("chatbot" for "enterprise assistant").
 * Fused, measured on the eval set: recall@5 14/23 with BM25 alone, 18/23 hybrid, nothing lost.
 * See docs/architecture.md and docs/evaluation.md.
 *
 * Why retrieval at all, when the whole corpus would fit in one prompt: see docs/architecture.md.
 * The short version is that it keeps the citation guard meaningful.
 */
const K1 = 1.5;
const B = 0.75;

/** Ceiling on units added by conflict force-inclusion, on top of top-k. See `retrieve`. */
const MAX_FORCED_UNITS = 5;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "did", "do", "does",
  "for", "from", "had", "has", "have", "he", "her", "his", "how", "i", "if", "in", "is", "it", "its",
  "me", "my", "of", "on", "or", "s", "she", "so", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "to", "was", "we", "were", "what", "when", "where", "which",
  "who", "why", "will", "with", "you", "your",
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    // Crude singularisation so "projects" matches "project". Deliberately not a stemmer: a real
    // stemmer is another dependency and another behaviour to explain for no measurable gain here.
    .map((token) => (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token));
}

/** Title terms are worth more than body terms, so the title is indexed twice. */
function indexableText(unit: KnowledgeUnit): string {
  return [unit.title, unit.title, unit.employer ?? "", unit.unitType, unit.text].join(" ");
}

interface IndexedUnit {
  unit: KnowledgeUnit;
  termFrequency: Map<string, number>;
  length: number;
}

interface Bm25Index {
  documents: IndexedUnit[];
  documentFrequency: Map<string, number>;
  averageLength: number;
}

function buildIndex(units: KnowledgeUnit[]): Bm25Index {
  const documents: IndexedUnit[] = units.map((unit) => {
    const tokens = tokenize(indexableText(unit));
    const termFrequency = new Map<string, number>();
    for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    return { unit, termFrequency, length: tokens.length };
  });

  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of document.termFrequency.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const totalLength = documents.reduce((sum, document) => sum + document.length, 0);
  return {
    documents,
    documentFrequency,
    averageLength: documents.length > 0 ? totalLength / documents.length : 0,
  };
}

/** One index per knowledge base, built on first use. A reloaded knowledge base gets a fresh index. */
const indexes = new WeakMap<KnowledgeBase, Bm25Index>();

function getIndex(kb: KnowledgeBase): Bm25Index {
  let index = indexes.get(kb);
  if (!index) {
    index = buildIndex(kb.units);
    indexes.set(kb, index);
  }
  return index;
}

export interface ScoredUnit {
  unit: KnowledgeUnit;
  score: number;
}

export interface RetrievalResult {
  /** What actually goes into the prompt: top-k plus force-included conflict partners. */
  units: KnowledgeUnit[];
  /** Top-k by score alone, before force-inclusion. Used by the eval's recall metric. */
  ranked: ScoredUnit[];
  /** Conflicts triggered because a retrieved unit is party to them. */
  conflicts: Conflict[];
}

/** Meaning-based input for hybrid retrieval, computed by lib/embeddings.ts before the call. */
export interface SemanticInput {
  /** The question's vector. */
  query: Float32Array;
  /** One vector per unit, in the same order as `kb.units`. */
  units: Float32Array[];
  /** Similarity below which a unit is not considered a match at all. Calibrated per model. */
  minSimilarity: number;
}

/**
 * Weight on a public GitHub repository's score. Repository units are thin metadata ("Public GitHub
 * repository X. Primary language: Y.") and there are many of them, so on a technology question they
 * crowded CV units out of the top k: asked "Does Jean know React?", the top 5 was tutorial repos
 * named after React and the CV's React roles were missing. Below 1, a repository wins only when
 * nothing from the CV or LinkedIn is close. Set by measurement (docs/evaluation.md).
 */
const REPOSITORY_WEIGHT = 0.5;

/** How many candidates each ranking contributes to the fusion. */
const CANDIDATES = 20;
/** The standard Reciprocal Rank Fusion constant: dampens the advantage of the very top ranks. */
const RRF_K = 60;

function bm25Rank(kb: KnowledgeBase, query: string): ScoredUnit[] {
  const index = getIndex(kb);
  const queryTerms = tokenize(query);
  const documentCount = index.documents.length;

  return index.documents
    .map(({ unit, termFrequency, length }) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = termFrequency.get(term);
        if (!frequency) continue;
        const documentFrequency = index.documentFrequency.get(term) ?? 0;
        // Standard BM25 IDF with the +1 that keeps it non-negative for terms in most documents.
        const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
        const normalisation = 1 - B + (B * length) / (index.averageLength || 1);
        score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * normalisation));
      }
      return { unit, score };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Vectors are normalised, so the dot product is the cosine similarity. */
function vectorRank(kb: KnowledgeBase, semantic: SemanticInput): ScoredUnit[] {
  return kb.units
    .map((unit, i) => {
      const vector = semantic.units[i]!;
      let score = 0;
      for (let d = 0; d < vector.length; d++) score += vector[d]! * semantic.query[d]!;
      return { unit, score };
    })
    .filter((scored) => scored.score >= semantic.minSimilarity)
    .sort((a, b) => b.score - a.score);
}

/**
 * Reciprocal Rank Fusion: each ranking contributes 1 / (RRF_K + rank) per unit. Ranks, not scores,
 * so a BM25 score never has to be compared with a cosine similarity. Ties keep BM25's order.
 */
function fuse(...rankings: ScoredUnit[][]): ScoredUnit[] {
  const fused = new Map<string, ScoredUnit>();
  for (const ranking of rankings) {
    ranking.slice(0, CANDIDATES).forEach(({ unit }, rank) => {
      const current = fused.get(unit.id) ?? { unit, score: 0 };
      fused.set(unit.id, { unit, score: current.score + 1 / (RRF_K + rank + 1) });
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

/**
 * Pure: the knowledge base and any vectors are passed in, so this never touches a database, a file
 * or a model. Without `semantic` it is BM25 alone; with it, BM25 and vector rankings are fused.
 */
export function retrieve(kb: KnowledgeBase, query: string, topK = 5, semantic?: SemanticInput): RetrievalResult {
  const lexical = bm25Rank(kb, query);
  const ranked = (semantic ? fuse(lexical, vectorRank(kb, semantic)) : lexical)
    .map((scored) => (scored.unit.unitType === "repository" ? { ...scored, score: scored.score * REPOSITORY_WEIGHT } : scored))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const { conflictsByUnitId, byId } = kb;
  const selected = new Map<string, KnowledgeUnit>(ranked.map(({ unit }) => [unit.id, unit]));
  const triggered = new Map<string, Conflict>();
  let forcedCount = 0;

  // Force-inclusion. Retrieving one side of a known disagreement pulls in the other side and the
  // resolution note regardless of score — otherwise the model answers confidently from one half of
  // a conflict it was never shown, which is the exact failure this system exists to prevent.
  //
  // Capped, because it is not free. Conflicts here span up to five units, and a unit can be party to
  // several, so an uncapped cascade can double the prompt on a question that needed one fact. The
  // cap is applied in rank order, so the conflicts attached to the best-matching units win the
  // budget. A conflict whose partners do not fit is still surfaced — its resolution note goes into
  // the prompt either way, so the disagreement is never silently dropped, only its citable units.
  for (const { unit } of ranked) {
    for (const conflict of conflictsByUnitId.get(unit.id) ?? []) {
      triggered.set(conflict.id, conflict);
      for (const partnerId of conflict.unitIds) {
        if (selected.has(partnerId)) continue;
        if (forcedCount >= MAX_FORCED_UNITS) break;
        const partner = byId.get(partnerId);
        if (partner) {
          selected.set(partner.id, partner);
          forcedCount++;
        }
      }
    }
  }

  return { units: [...selected.values()], ranked, conflicts: [...triggered.values()] };
}

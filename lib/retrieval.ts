import type { KnowledgeBase } from "./knowledge";
import type { Conflict, KnowledgeUnit } from "./models";

/**
 * BM25 over ~43 short units.
 *
 * Why lexical rather than embeddings: at this corpus size an embedding provider buys no measurable
 * recall and costs a dependency, a second network call on every question, and a second thing that
 * can be down. Interview questions are also unusually keyword-dense — "KPMG", "Storybook",
 * "Supabase", "Scrum" — which is exactly where BM25 is strong.
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

/** Pure: the knowledge base is passed in, so this never touches a database or a file. */
export function retrieve(kb: KnowledgeBase, query: string, topK = 5): RetrievalResult {
  const index = getIndex(kb);
  const queryTerms = tokenize(query);
  const documentCount = index.documents.length;

  const ranked: ScoredUnit[] = index.documents
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

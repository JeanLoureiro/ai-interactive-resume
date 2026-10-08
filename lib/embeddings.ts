import path from "node:path";
import type { KnowledgeBase } from "./knowledge";
import type { KnowledgeUnit } from "./models";
import type { SemanticInput } from "./retrieval";

/**
 * The local embedding model behind hybrid retrieval. Runs in-process via transformers.js: no API
 * key, no network call per question, nothing leaves the server.
 *
 * Chosen by measurement (docs/evaluation.md): on this knowledge base, bge-small met every bar for
 * becoming the default and all-MiniLM-L6-v2 did not. `minSimilarity` is calibrated for this model
 * only: off-topic questions topped out at 0.45, the weakest answerable one scored 0.48.
 */
export const EMBEDDING_MODEL = {
  id: "Xenova/bge-small-en-v1.5",
  /** bge models are trained with this prefix on queries (never on passages). */
  queryPrefix: "Represent this sentence for searching relevant passages: ",
  minSimilarity: 0.47,
} as const;

/**
 * Model files live here, fetched by `pnpm models:fetch` (run by `pnpm build`) and shipped with the
 * /api/ask function (next.config.ts). In production nothing is downloaded at request time: a cold
 * start that had to fetch the model from Hugging Face would be slow and a second thing that can be
 * down, so a missing model falls back to BM25 and says so in the log.
 */
export const MODEL_DIR = path.join(process.cwd(), "models");

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

let extractor: Promise<Embedder> | undefined;

/** Loaded on first use and kept for the life of the server instance. */
function defaultEmbedder(): Promise<Embedder> {
  extractor ??= import("@huggingface/transformers")
    .then(({ pipeline, env }) => {
      env.cacheDir = MODEL_DIR;
      env.allowRemoteModels = process.env["NODE_ENV"] !== "production";
      return pipeline("feature-extraction", EMBEDDING_MODEL.id, { dtype: "q8" });
    })
    .then((extract) => async (texts: string[]) => {
      const output = await extract(texts, { pooling: "mean", normalize: true });
      return (output.tolist() as number[][]).map((vector) => Float32Array.from(vector));
    })
    .catch((error: unknown) => {
      extractor = undefined;
      throw error;
    });
  return extractor;
}

const unitText = (unit: KnowledgeUnit) => `${unit.title}\n${unit.text}`;

/** Unit vectors are computed once per loaded knowledge base, so a publish re-embeds automatically. */
const unitVectors = new WeakMap<KnowledgeBase, Promise<Float32Array[]>>();

function getUnitVectors(kb: KnowledgeBase, embed: Embedder): Promise<Float32Array[]> {
  let vectors = unitVectors.get(kb);
  if (!vectors) {
    vectors = embed(kb.units.map(unitText));
    unitVectors.set(kb, vectors);
    vectors.catch(() => unitVectors.delete(kb));
  }
  return vectors;
}

/**
 * Everything hybrid retrieval needs for one question, or undefined when embeddings are unavailable.
 *
 * Undefined means "answer with BM25 alone", never a refusal: a model that fails to load degrades
 * retrieval, and the log says so loudly so it does not stay degraded unnoticed.
 */
export async function semanticInput(
  kb: KnowledgeBase,
  question: string,
  loadEmbedder: () => Promise<Embedder> = defaultEmbedder,
): Promise<SemanticInput | undefined> {
  try {
    const embed = await loadEmbedder();
    const [units, [query]] = await Promise.all([
      getUnitVectors(kb, embed),
      embed([EMBEDDING_MODEL.queryPrefix + question]),
    ]);
    if (!query) throw new Error("The embedding model returned no vector for the question.");
    return { query, units, minSimilarity: EMBEDDING_MODEL.minSimilarity };
  } catch (error) {
    console.error("Embeddings unavailable, answering with BM25 only:", error);
    return undefined;
  }
}

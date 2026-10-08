/**
 * Downloads the embedding model into models/ so the app never fetches it at request time.
 * Run by `pnpm build`; safe to re-run (files already present are reused).
 */
import { env, pipeline } from "@huggingface/transformers";
import { EMBEDDING_MODEL, MODEL_DIR } from "../lib/embeddings";

async function main(): Promise<void> {
  env.cacheDir = MODEL_DIR;
  env.allowRemoteModels = true;
  await pipeline("feature-extraction", EMBEDDING_MODEL.id, { dtype: "q8" });
  console.log(`Embedding model ready: ${EMBEDDING_MODEL.id} in models/`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

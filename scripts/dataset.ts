/** The eval dataset's shape and loader, shared by the full eval and the retrieval-only eval. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const CaseSchema = z.object({
  id: z.string(),
  category: z.enum(["direct", "multi_source", "ambiguous", "unanswerable", "adversarial", "paraphrase", "follow_up"]),
  question: z.string(),
  goldSourceIds: z.array(z.string()),
  mustContain: z.array(z.string()),
  mustNotClaim: z.array(z.string()),
  expectsRefusal: z.boolean(),
  expectsConflict: z.string().nullable(),
  note: z.string(),
  /** Scripted earlier turns, for follow-up questions. Scripted rather than generated, so a run is
   *  deterministic and costs one call per case. */
  history: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
});
export type EvalCase = z.infer<typeof CaseSchema>;

export const DATASET_PATH = path.join(process.cwd(), "eval", "dataset.jsonl");

export async function loadDataset(): Promise<EvalCase[]> {
  const raw = await readFile(DATASET_PATH, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return CaseSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`eval/dataset.jsonl line ${index + 1} is invalid`, { cause: error });
      }
    });
}

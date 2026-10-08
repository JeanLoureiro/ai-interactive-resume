import { z } from "zod";

/**
 * The unit of retrieval and the unit of citation — deliberately the same thing.
 *
 * If those two differed, a citation could point at something coarser or finer than what the model
 * was actually shown, and "this claim traces to that source" would stop being checkable.
 */
export const KnowledgeUnitSchema = z.object({
  /** Stable, human-readable, e.g. "cv:kpmg-harness-engineering". Stable ids matter: they appear in
   *  eval gold labels, so regenerating the knowledge base must not silently invalidate the dataset. */
  id: z.string().min(1),
  source: z.enum(["cv", "linkedin", "github"]),
  unitType: z.enum([
    "summary",
    "skill",
    "employment",
    "project",
    "certificate",
    "education",
    "profile",
    "repository",
  ]),
  title: z.string().min(1),
  text: z.string().min(1),
  employer: z.string().optional(),
  /** ISO-ish "YYYY-MM". Absent means the source did not state it — never inferred. */
  dateStart: z.string().optional(),
  /** Absent with a present dateStart means ongoing. */
  dateEnd: z.string().optional(),
  link: z.string().optional(),
  /** When this unit was pulled from its source. Makes staleness an explicit property. */
  retrievedAt: z.string(),
});
export type KnowledgeUnit = z.infer<typeof KnowledgeUnitSchema>;

/**
 * A known disagreement between sources, recorded as data rather than baked into a prompt.
 *
 * Prompt text would make conflict handling invisible to tests and impossible to enumerate. As data,
 * each conflict can be asserted on, counted, and force-included at retrieval time.
 */
export const ConflictSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["stale", "contradiction", "gap", "ambiguity"]),
  /** Units on each side. Retrieving any one of these pulls in the others. */
  unitIds: z.array(z.string().min(1)).min(1),
  /** What the system must convey when a question lands here. Shown to the model as context. */
  resolutionNote: z.string().min(1),
});
export type Conflict = z.infer<typeof ConflictSchema>;

/**
 * What the model is constrained to return.
 *
 * `sourceIds` is non-empty by construction, so the schema itself forbids an uncited claim. This is a
 * guarantee about *shape*, not about truth — see guard.ts for what is actually enforced, and the
 * README for what is knowingly not.
 */
export const AnswerSchema = z.object({
  answerText: z
    .string()
    .describe("The answer to show the user. Plain prose, no citation markers — citations live in claims."),
  claims: z
    .array(
      z.object({
        text: z.string().describe("A single factual assertion made in answerText."),
        sourceIds: z
          .array(z.string())
          .min(1)
          .describe("Ids of the provided knowledge units that support this exact claim."),
      }),
    )
    .describe("Every factual assertion in answerText, each tied to the units that support it."),
  hasSufficientContext: z
    .boolean()
    .describe(
      "False when the provided units do not contain the answer. A hint only — the server verifies citations independently.",
    ),
});
export type Answer = z.infer<typeof AnswerSchema>;

/** Why a response ended up as it did. Surfaced in the UI and asserted on in the eval. */
export type ResponseStatus =
  /** Model answered and every citation survived the guard. */
  | "answered"
  /** Nothing retrieved, or the model reported it could not answer from what it was given. */
  | "insufficient_context"
  /** Model answered but cited something it was not given, or asserted with no citation at all. */
  | "guard_rejected"
  /** The provider errored, timed out, or returned something unparseable. */
  | "provider_error";

export interface ResolvedClaim {
  text: string;
  sources: KnowledgeUnit[];
}

export interface AssistantResponse {
  status: ResponseStatus;
  /** Prose for the user. For every non-"answered" status this is a deterministic template, never
   *  model output — a refusal that was itself generated could hallucinate its own reason. */
  answerText: string;
  claims: ResolvedClaim[];
  /** Units retrieved for this question, shown in the UI whether or not the model used them. */
  retrieved: KnowledgeUnit[];
  /** Conflicts force-included because a retrieved unit is party to them. */
  conflicts: Conflict[];
  diagnostics: {
    model: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    /** Ids the model cited that were not in the retrieved set. Non-empty means guard_rejected. */
    invalidSourceIds: string[];
    /** Top-k by retrieval rank alone, before conflict force-inclusion. What recall is scored on. */
    rankedSourceIds: string[];
  };
}

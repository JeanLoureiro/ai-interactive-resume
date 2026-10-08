import { getKnowledgeBase } from "./knowledge";
import { retrieve } from "./retrieval";
import { generate, GenerationError } from "./generation";
import { checkCitations } from "./guard";
import * as fallback from "./fallback";
import { costUsd, getFastModel, getModel, getRetrievalMode, getTopK } from "./config";
import { followUpQuery, type ConversationTurn } from "./conversation";
import { getLlmProvider } from "./llm";
import { semanticInput } from "./embeddings";
import type { AssistantResponse } from "./models";

export interface AskOptions {
  model?: string;
  topK?: number;
  /**
   * Override the call to the model.
   *
   * Injected rather than module-mocked so the failure paths — provider down, unparseable output,
   * fabricated citation — can be exercised against the real pipeline. Those branches are the ones
   * that matter most here and the ones hardest to trigger against a live API on demand.
   */
  generateFn?: typeof generate;
  /**
   * Earlier turns of this conversation, loaded server-side. Used to understand a follow-up, never
   * as a source: the guard still accepts only units retrieved for this turn.
   */
  history?: ConversationTurn[];
}

/**
 * The single entry point: question in, AssistantResponse out.
 *
 * The API route and the eval both call this, deliberately. If the eval exercised a different path
 * from the one users hit, it would be measuring a system nobody uses.
 */
export async function ask(question: string, options: AskOptions = {}): Promise<AssistantResponse> {
  const model = options.model ?? getModel();
  const startedAt = Date.now();
  const history = options.history ?? [];
  const kb = await getKnowledgeBase();
  // A follow-up is searched as a standalone question ("And before that?" -> "What did Jean do before
  // KPMG?"). The rewrite is for retrieval only; the model below still answers the visitor's words.
  const query = await followUpQuery(question, history, getLlmProvider, getFastModel());
  const semantic = getRetrievalMode() === "hybrid" ? await semanticInput(kb, query) : undefined;
  const { units, conflicts, ranked } = retrieve(kb, query, options.topK ?? getTopK(), semantic);
  const rankedSourceIds = ranked.map(({ unit }) => unit.id);

  const base = {
    retrieved: units,
    conflicts,
    claims: [],
    diagnostics: {
      model,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      invalidSourceIds: [] as string[],
      rankedSourceIds,
    },
  };

  // Nothing matched, so there is nothing to ground an answer in. Refusing here rather than asking
  // the model to refuse saves a call, and makes the refusal certain instead of likely.
  if (units.length === 0) {
    return {
      ...base,
      status: "insufficient_context",
      answerText: fallback.nothingRetrieved(),
      diagnostics: { ...base.diagnostics, latencyMs: Date.now() - startedAt },
    };
  }

  try {
    const result = await (options.generateFn ?? generate)(question, units, conflicts, model, history);
    const guard = checkCitations(result.answer, units);
    const diagnostics = {
      model: result.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: costUsd(result.model, result.inputTokens, result.outputTokens),
      invalidSourceIds: guard.invalidSourceIds,
      rankedSourceIds,
    };

    // Order matters. The guard is checked before the model's own sufficiency flag, because a model
    // that fabricated a citation has already shown its self-report is not worth trusting on this
    // turn — including its report that it had enough context.
    if (!guard.ok) {
      return {
        ...base,
        status: "guard_rejected",
        answerText: fallback.guardRejected(),
        diagnostics,
      };
    }

    if (!result.answer.hasSufficientContext) {
      return {
        ...base,
        status: "insufficient_context",
        answerText: fallback.insufficientContext(result.answer.answerText),
        claims: guard.claims,
        diagnostics,
      };
    }

    return {
      ...base,
      status: "answered",
      answerText: result.answer.answerText,
      claims: guard.claims,
      diagnostics,
    };
  } catch (error) {
    if (error instanceof GenerationError) {
      return {
        ...base,
        status: "provider_error",
        answerText: fallback.providerError(),
        diagnostics: { ...base.diagnostics, latencyMs: Date.now() - startedAt },
      };
    }
    throw error;
  }
}

import { z } from "zod";
import { GenerationError, LlmConfigurationError, type LlmProvider, type StructuredRequest, type StructuredResult } from "./types";

export interface OpenAiCompatibleOptions {
  apiKey: string;
  /** e.g. https://api.openai.com/v1 or https://api.deepseek.com, no trailing slash. */
  baseUrl: string;
  structuredOutput: "json_schema" | "json_object";
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}

const RETRIES = 2;
const TIMEOUT_MS = 60_000;

interface Completion {
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any API that speaks OpenAI's Chat Completions format: OpenAI, DeepSeek, Gemini's compatibility
 * endpoint, Groq, OpenRouter, Ollama. Plain fetch, no SDK, so one adapter covers all of them.
 *
 * No token limit is sent: the parameter's name differs between providers and model families
 * (max_tokens vs max_completion_tokens), and an unknown name is rejected by some of them. Responses
 * here are short structured objects, so the model's own default limit is ample.
 */
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 500;

  async function post(body: unknown): Promise<Completion> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      let response: Response;
      try {
        response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error; // network failure or timeout: retry
        continue;
      }
      if (response.ok) return (await response.json()) as Completion;
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}: ${detail}`);
        continue;
      }
      throw new LlmConfigurationError(
        `The LLM provider rejected the request (HTTP ${response.status}). Check LLM_API_KEY, LLM_MODEL, LLM_BASE_URL and LLM_STRUCTURED_OUTPUT. ${detail}`,
      );
    }
    throw new GenerationError(
      { kind: "provider_unavailable", message: lastError instanceof Error ? lastError.message : String(lastError) },
      { cause: lastError },
    );
  }

  return {
    name: "openai-compatible",
    async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const jsonSchema = z.toJSONSchema(request.schema);
      const system =
        options.structuredOutput === "json_object"
          ? `${request.system}\n\nReply with a single JSON object, and nothing else, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`
          : request.system;
      const completion = await post({
        model: request.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: request.user },
        ],
        response_format:
          options.structuredOutput === "json_schema"
            ? // Non-strict on purpose: strict mode rejects optional fields. Zod validates below.
              { type: "json_schema", json_schema: { name: "response", schema: jsonSchema, strict: false } }
            : { type: "json_object" },
      });

      const choice = completion.choices?.[0];
      const unparseable = (message: string) => new GenerationError({ kind: "unparseable", message });
      if (!choice?.message?.content) throw unparseable(`No content in the reply (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
      if (choice.finish_reason === "length") throw unparseable("The reply was cut off at the token limit");

      let json: unknown;
      try {
        json = JSON.parse(choice.message.content);
      } catch {
        throw unparseable("The reply was not valid JSON");
      }
      const parsed = request.schema.safeParse(json);
      if (!parsed.success) throw unparseable(`The reply did not match the schema: ${parsed.error.issues[0]?.message ?? ""}`);

      return {
        data: parsed.data,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      };
    },
  };
}

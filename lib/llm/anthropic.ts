import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GenerationError, type LlmProvider, type StructuredRequest, type StructuredResult } from "./types";

export function createAnthropicProvider(apiKey: string): LlmProvider {
  // Two retries on 429/5xx/connection errors is the SDK default and is left in place: a transient
  // blip should not surface to the user as a refusal, because a refusal reads as "no such fact".
  const client = new Anthropic({ apiKey, timeout: 60_000 });

  return {
    name: "anthropic",
    async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      // No thinking or effort parameters. Those are configured differently across model families,
      // and the eval compares models on identical inputs — branching per model would mean the
      // comparison measured the branching as much as the model.
      let response;
      try {
        response = await client.messages.parse({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
          output_config: { format: zodOutputFormat(request.schema) },
        });
      } catch (error) {
        throw new GenerationError(
          { kind: "provider_unavailable", message: error instanceof Error ? error.message : String(error) },
          { cause: error },
        );
      }

      const parsed = response.parsed_output as T | null;
      if (parsed === null || parsed === undefined) {
        // parsed_output is null when the content did not satisfy the schema. Treated as a failure,
        // not as an empty result: falling through would hand the caller an answer with no claims,
        // which looks identical to a well-formed refusal and would be scored as one.
        throw new GenerationError({
          kind: "unparseable",
          message: `Model returned no schema-valid output (stop_reason: ${response.stop_reason ?? "unknown"})`,
        });
      }

      return {
        data: parsed,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}

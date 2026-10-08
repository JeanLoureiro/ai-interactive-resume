import { getLlmConfig } from "../config";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAiCompatibleProvider } from "./openai-compatible";
import type { LlmProvider } from "./types";

export { GenerationError, LlmConfigurationError, type GenerationFailure, type LlmProvider } from "./types";

let provider: LlmProvider | undefined;

/**
 * One provider per process, chosen by LLM_PROVIDER. Throws on missing configuration before any
 * request is attempted, naming the variable to set.
 */
export function getLlmProvider(): LlmProvider {
  if (!provider) {
    const config = getLlmConfig();
    provider =
      config.provider === "anthropic"
        ? createAnthropicProvider(config.apiKey)
        : createOpenAiCompatibleProvider({
            apiKey: config.apiKey,
            baseUrl: config.baseUrl!,
            structuredOutput: config.structuredOutput!,
          });
  }
  return provider;
}

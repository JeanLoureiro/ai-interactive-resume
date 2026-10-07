import { getApiKey } from "../config";
import { createAnthropicProvider } from "./anthropic";
import type { LlmProvider } from "./types";

export { GenerationError, type GenerationFailure, type LlmProvider } from "./types";

let provider: LlmProvider | undefined;

/** One provider per process. Throws on a missing key, before any request is attempted. */
export function getLlmProvider(): LlmProvider {
  provider ??= createAnthropicProvider(getApiKey());
  return provider;
}

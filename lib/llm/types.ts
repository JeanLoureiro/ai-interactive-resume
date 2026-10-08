import type { z } from "zod";

export interface StructuredRequest<T> {
  model: string;
  system: string;
  user: string;
  /** The provider must return data matching this, or throw GenerationError("unparseable"). */
  schema: z.ZodType<T>;
  maxTokens: number;
}

export interface StructuredResult<T> {
  data: T;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The only thing the rest of the app knows about a language model.
 *
 * Answer generation and resume structuring both go through this, so adding a provider is one new
 * file implementing it, with no change to either caller.
 */
export interface LlmProvider {
  readonly name: string;
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export type GenerationFailure =
  /** Network, timeout, rate limit, 5xx — anything where the provider did not return a usable turn. */
  | { kind: "provider_unavailable"; message: string }
  /** The provider responded, but the payload did not satisfy the schema. */
  | { kind: "unparseable"; message: string };

export class GenerationError extends Error {
  readonly failure: GenerationFailure;
  constructor(failure: GenerationFailure, options?: { cause?: unknown }) {
    super(failure.message, options);
    this.name = "GenerationError";
    this.failure = failure;
  }
}

/**
 * The provider rejected the request itself: bad key, no access, unknown model, or a request shape it
 * does not accept. Not retried, and deliberately not a GenerationError: it surfaces as a loud
 * "misconfigured" error rather than "the model is unavailable, try again", because retrying a
 * revoked key never works and a visitor should not be told it might.
 */
export class LlmConfigurationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmConfigurationError";
  }
}

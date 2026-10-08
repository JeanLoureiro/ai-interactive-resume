import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAnthropicProvider } from "../lib/llm/anthropic";
import { GenerationError, LlmConfigurationError } from "../lib/llm/types";

const request = { model: "claude-sonnet-5", system: "s", user: "u", schema: z.object({ a: z.string() }), maxTokens: 100 };

/** A client whose messages.parse throws the given error, to exercise the adapter's error mapping. */
const failingWith = (error: unknown) =>
  createAnthropicProvider("sk-test", {
    messages: { parse: async () => Promise.reject(error) },
  } as unknown as Pick<Anthropic, "messages">);

describe("Anthropic adapter errors", () => {
  it("reports a bad key, missing access, unknown model or bad request as configuration", async () => {
    const errors = [
      new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", new Headers()),
      new Anthropic.PermissionDeniedError(403, {}, "no access", new Headers()),
      new Anthropic.NotFoundError(404, {}, "model: claude-nope", new Headers()),
      new Anthropic.BadRequestError(400, {}, "bad request", new Headers()),
    ];
    for (const error of errors) {
      await expect(failingWith(error).generateStructured(request)).rejects.toBeInstanceOf(LlmConfigurationError);
    }
  });

  it("keeps rate limits, server errors and network failures as provider unavailable", async () => {
    const errors = [
      new Anthropic.RateLimitError(429, {}, "slow down", new Headers()),
      new Anthropic.InternalServerError(500, {}, "oops", new Headers()),
      new Anthropic.APIConnectionError({ message: "reset" }),
    ];
    for (const error of errors) {
      const thrown = await failingWith(error).generateStructured(request).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(GenerationError);
      expect((thrown as GenerationError).failure.kind).toBe("provider_unavailable");
    }
  });
});

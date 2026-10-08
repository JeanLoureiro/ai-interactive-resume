import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createOpenAiCompatibleProvider } from "../lib/llm/openai-compatible";
import { GenerationError, LlmConfigurationError } from "../lib/llm/types";

const Schema = z.object({ answer: z.string(), sources: z.array(z.string()).min(1), note: z.string().optional() });
const request = { model: "test-model", system: "SYSTEM", user: "QUESTION", schema: Schema, maxTokens: 1000 };

type Reply = { status: number; body: unknown } | Error;

/** A fetch that answers from a script and records every request it was sent. */
function fakeFetch(...replies: Reply[]) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: Record<string, any> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const reply = replies.shift() ?? { status: 500, body: {} };
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

const completion = (content: string, finish = "stop") => ({
  status: 200,
  body: { choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
});

const provider = (fetchImpl: typeof fetch, structuredOutput: "json_schema" | "json_object" = "json_schema") =>
  createOpenAiCompatibleProvider({ apiKey: "sk-test", baseUrl: "https://llm.example/v1", structuredOutput, fetchImpl, retryDelayMs: 0 });

describe("openai-compatible provider", () => {
  it("sends a json_schema request built from the Zod schema and returns validated data", async () => {
    const { fetchImpl, sent } = fakeFetch(completion(JSON.stringify({ answer: "Yes.", sources: ["cv:a"] })));
    const result = await provider(fetchImpl).generateStructured(request);

    expect(result).toEqual({ data: { answer: "Yes.", sources: ["cv:a"] }, inputTokens: 120, outputTokens: 30 });
    const [call] = sent;
    expect(call!.url).toBe("https://llm.example/v1/chat/completions");
    expect(call!.headers["authorization"]).toBe("Bearer sk-test");
    expect(call!.body.messages).toEqual([{ role: "system", content: "SYSTEM" }, { role: "user", content: "QUESTION" }]);
    expect(call!.body.response_format.type).toBe("json_schema");
    // Non-strict: strict mode forbids optional fields, which the resume schema has. Zod enforces shape.
    expect(call!.body.response_format.json_schema.strict).toBe(false);
    expect(call!.body.response_format.json_schema.schema.required).toEqual(["answer", "sources"]);
  });

  it("puts the schema in the system prompt for json_object providers", async () => {
    const { fetchImpl, sent } = fakeFetch(completion(JSON.stringify({ answer: "No.", sources: ["cv:b"] })));
    await provider(fetchImpl, "json_object").generateStructured(request);
    expect(sent[0]!.body.response_format).toEqual({ type: "json_object" });
    expect(sent[0]!.body.messages[0].content).toMatch(/^SYSTEM[\s\S]*JSON[\s\S]*"sources"/);
  });

  it("treats invalid JSON, a wrong shape, and a truncated reply as unparseable", async () => {
    for (const reply of [completion("not json"), completion(JSON.stringify({ answer: "x", sources: [] })), completion('{"answer":"cut', "length")]) {
      const { fetchImpl } = fakeFetch(reply);
      const error = await provider(fetchImpl).generateStructured(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).failure.kind).toBe("unparseable");
    }
  });

  it("retries rate limits, server errors and network failures, then reports the provider unavailable", async () => {
    const ok = completion(JSON.stringify({ answer: "Yes.", sources: ["cv:a"] }));
    const recovered = fakeFetch({ status: 429, body: {} }, new TypeError("fetch failed"), ok);
    await expect(provider(recovered.fetchImpl).generateStructured(request)).resolves.toBeDefined();
    expect(recovered.sent).toHaveLength(3);

    const down = fakeFetch({ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} });
    const error = await provider(down.fetchImpl).generateStructured(request).catch((e: unknown) => e);
    expect((error as GenerationError).failure.kind).toBe("provider_unavailable");
    expect(down.sent).toHaveLength(3);
  });

  it("reports a bad key, unknown model or rejected request as configuration, without retrying", async () => {
    for (const status of [400, 401, 403, 404]) {
      const { fetchImpl, sent } = fakeFetch({ status, body: { error: { message: "nope" } } });
      const error = await provider(fetchImpl).generateStructured(request).catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(LlmConfigurationError);
      expect(sent).toHaveLength(1);
    }
  });
});

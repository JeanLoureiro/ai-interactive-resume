import { afterEach, describe, expect, it, vi } from "vitest";
import { costUsd, getLlmConfig, getModel, getResumeModel, isPricedModel } from "../lib/config";

const clear = () => {
  for (const name of ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "LLM_STRUCTURED_OUTPUT", "LLM_PRICE_INPUT", "LLM_PRICE_OUTPUT", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "RESUME_MODEL"]) {
    vi.stubEnv(name, "");
  }
};
afterEach(() => vi.unstubAllEnvs());

describe("LLM configuration", () => {
  it("defaults to Anthropic and still honours ANTHROPIC_API_KEY and ANTHROPIC_MODEL", () => {
    clear();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    expect(getLlmConfig()).toMatchObject({ provider: "anthropic", apiKey: "sk-ant-test" });
    expect(getModel()).toBe("claude-sonnet-5-5");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku-4-5");
    expect(getModel()).toBe("claude-haiku-4-5");
  });

  it("prefers the LLM_* names when both are set", () => {
    clear();
    vi.stubEnv("ANTHROPIC_API_KEY", "old");
    vi.stubEnv("LLM_API_KEY", "new");
    vi.stubEnv("LLM_MODEL", "claude-sonnet-5-5");
    expect(getLlmConfig().apiKey).toBe("new");
    expect(getModel()).toBe("claude-sonnet-5-5");
  });

  it("configures an OpenAI-compatible provider, defaulting to json_schema output", () => {
    clear();
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_API_KEY", "sk-test");
    vi.stubEnv("LLM_BASE_URL", "https://api.deepseek.com/");
    vi.stubEnv("LLM_MODEL", "deepseek-chat");
    expect(getLlmConfig()).toEqual({
      provider: "openai-compatible",
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      structuredOutput: "json_schema",
    });
  });

  it("names exactly what is missing", () => {
    clear();
    expect(() => getLlmConfig()).toThrow(/LLM_API_KEY/);
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_API_KEY", "sk-test");
    expect(() => getLlmConfig()).toThrow(/LLM_BASE_URL/);
    vi.stubEnv("LLM_BASE_URL", "https://api.openai.com/v1");
    expect(() => getModel()).toThrow(/LLM_MODEL/);
    vi.stubEnv("LLM_PROVIDER", "openai");
    expect(() => getLlmConfig()).toThrow(/LLM_PROVIDER/);
  });

  it("structures resumes with Haiku on Anthropic, and with the answering model elsewhere", () => {
    clear();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    expect(getResumeModel()).toBe("claude-haiku-4-5");
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_MODEL", "gpt-5-mini");
    expect(getResumeModel()).toBe("gpt-5-mini");
    vi.stubEnv("RESUME_MODEL", "gpt-5-nano");
    expect(getResumeModel()).toBe("gpt-5-nano");
  });

  it("prices any model from LLM_PRICE_*, and never guesses", () => {
    clear();
    expect(isPricedModel("deepseek-chat")).toBe(false);
    expect(costUsd("deepseek-chat", 1_000_000, 1_000_000)).toBe(0);
    vi.stubEnv("LLM_PRICE_INPUT", "0.27");
    vi.stubEnv("LLM_PRICE_OUTPUT", "1.10");
    expect(isPricedModel("deepseek-chat")).toBe(true);
    expect(costUsd("deepseek-chat", 1_000_000, 1_000_000)).toBeCloseTo(1.37, 6);
  });
});

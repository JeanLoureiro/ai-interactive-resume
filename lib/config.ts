import { z } from "zod";

/** Published Anthropic list prices, USD per million tokens. Used to turn real token counts from
 *  `response.usage` into a real cost per question — the brief asks for a measured number, not an
 *  estimate, so this only ever multiplies tokens the API actually reported. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** LLM_PRICE_INPUT / LLM_PRICE_OUTPUT (USD per million tokens) price any model, e.g. a non-Anthropic one. */
function configuredPrice(): { input: number; output: number } | undefined {
  const input = Number.parseFloat(process.env["LLM_PRICE_INPUT"] ?? "");
  const output = Number.parseFloat(process.env["LLM_PRICE_OUTPUT"] ?? "");
  return Number.isFinite(input) && Number.isFinite(output) ? { input, output } : undefined;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = configuredPrice() ?? PRICING[model];
  // An unknown model returns 0 rather than guessing a price. A fabricated cost figure in a report
  // about a system built to not fabricate would be a poor look, and a zero is obviously wrong.
  if (!rates) return 0;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

export function isPricedModel(model: string): boolean {
  return configuredPrice() !== undefined || model in PRICING;
}

const env = (name: string) => process.env[name]?.trim() || undefined;

export type LlmProviderName = "anthropic" | "openai-compatible";

export interface LlmConfig {
  provider: LlmProviderName;
  apiKey: string;
  /** openai-compatible only: e.g. https://api.openai.com/v1, without a trailing slash. */
  baseUrl?: string;
  /** openai-compatible only: json_schema where the provider supports it, json_object otherwise. */
  structuredOutput?: "json_schema" | "json_object";
}

/**
 * Which LLM answers. Anthropic by default; any OpenAI-compatible API (OpenAI, DeepSeek, Gemini,
 * Groq, OpenRouter, Ollama) with LLM_PROVIDER=openai-compatible. ANTHROPIC_API_KEY keeps working for
 * Anthropic, so an existing .env does not break. Every missing value is named in the error.
 */
export function getLlmConfig(): LlmConfig {
  const provider = env("LLM_PROVIDER") ?? "anthropic";
  if (provider !== "anthropic" && provider !== "openai-compatible") {
    throw new Error(`LLM_PROVIDER must be "anthropic" or "openai-compatible", not "${provider}".`);
  }
  const apiKey = env("LLM_API_KEY") ?? (provider === "anthropic" ? env("ANTHROPIC_API_KEY") : undefined);
  if (!apiKey) {
    throw new Error("LLM_API_KEY is not set. Add your provider's API key to .env; see the README.");
  }
  if (provider === "anthropic") return { provider, apiKey };

  const baseUrl = env("LLM_BASE_URL")?.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("LLM_BASE_URL is not set. openai-compatible needs the provider's API URL; see the README.");
  const structuredOutput = env("LLM_STRUCTURED_OUTPUT") ?? "json_schema";
  if (structuredOutput !== "json_schema" && structuredOutput !== "json_object") {
    throw new Error(`LLM_STRUCTURED_OUTPUT must be "json_schema" or "json_object", not "${structuredOutput}".`);
  }
  return { provider, apiKey, baseUrl, structuredOutput };
}

/**
 * The answering model. Defaults to claude-sonnet-5-5 on Anthropic, chosen by eval (see
 * docs/evaluation.md); required for any other provider.
 */
export function getModel(): string {
  const model = env("LLM_MODEL") ?? env("ANTHROPIC_MODEL");
  if (model) return model;
  if ((env("LLM_PROVIDER") ?? "anthropic") === "anthropic") return DEFAULT_MODEL;
  throw new Error("LLM_MODEL is not set. Name the model to use with your provider, e.g. gpt-5-mini.");
}

export function getTopK(): number {
  const raw = process.env["RETRIEVAL_TOP_K"];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}


/** Blank env values count as unset, so `GITHUB_USERNAME=` in a copied .env disables the source. */
const optional = (schema: z.ZodString) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

const SubjectSchema = z.object({
  name: z.string().trim().min(1, "SUBJECT_NAME is not set. Add the person this assistant is about to .env — see the README."),
  shortName: optional(z.string().trim()),
  linkedinProfile: optional(z.string().trim().url("LINKEDIN_PROFILE must be a full URL, e.g. https://www.linkedin.com/in/you")),
  githubUsername: optional(z.string().trim()),
});

/** Who the assistant answers about. Every subject-facing string is built from this. */
export interface Subject {
  /** Full name, used where precision matters: the system prompt's first line. */
  name: string;
  /** How the UI and prose refer to them, e.g. a first name. Defaults to `name`. */
  shortName: string;
  linkedinProfile?: string;
  githubUsername?: string;
}

export function getSubject(): Subject {
  const parsed = SubjectSchema.safeParse({
    name: process.env["SUBJECT_NAME"] ?? "",
    shortName: process.env["SUBJECT_SHORT_NAME"],
    linkedinProfile: process.env["LINKEDIN_PROFILE"],
    githubUsername: process.env["GITHUB_USERNAME"],
  });
  if (!parsed.success) {
    // Thrown, not defaulted: an assistant answering about an unnamed person is a configuration
    // fault, and it must not reach a visitor looking like a working page.
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }
  const { name, shortName, linkedinProfile, githubUsername } = parsed.data;
  return {
    name,
    shortName: shortName ?? name,
    ...(linkedinProfile ? { linkedinProfile } : {}),
    ...(githubUsername ? { githubUsername } : {}),
  };
}

/** "CV, public LinkedIn profile and public GitHub repositories", trimmed to what is configured. */
export function describeSources(subject: Subject): string {
  const sources = ["CV"];
  if (subject.linkedinProfile) sources.push("public LinkedIn profile");
  if (subject.githubUsername) sources.push("public GitHub repositories");
  return sources.length === 1
    ? sources[0]!
    : `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)!}`;
}

/**
 * Model that splits a PDF or DOCX resume into entries. Separate from the answering model because the
 * task is copying, not reasoning: measured on a real resume, Haiku kept the same 23 units as Sonnet
 * with nothing dropped by the guard, in 31 s instead of about 2 minutes, at a sixth of the cost.
 * On another provider it defaults to the answering model, since a Claude model id would not exist there.
 */
export function getResumeModel(): string {
  return env("RESUME_MODEL") ?? getFastModel();
}

/**
 * A cheaper, faster model for mechanical tasks: structuring a resume, rewriting a follow-up into a
 * standalone search query. claude-haiku-4-5 on Anthropic; the answering model elsewhere, since a
 * Claude model id would not exist on another provider. FAST_MODEL overrides it.
 */
export function getFastModel(): string {
  const configured = env("FAST_MODEL");
  if (configured) return configured;
  return (env("LLM_PROVIDER") ?? "anthropic") === "anthropic" ? "claude-haiku-4-5" : getModel();
}

/** Blank or unset means /admin does not exist. */
export function getAdminPassword(): string | undefined {
  return process.env["ADMIN_PASSWORD"] || undefined;
}

export type RetrievalMode = "hybrid" | "bm25";

/** Hybrid by default: it met every bar in docs/evaluation.md. `bm25` turns the embedding model off. */
export function getRetrievalMode(): RetrievalMode {
  return process.env["RETRIEVAL_MODE"]?.trim() === "bm25" ? "bm25" : "hybrid";
}

/** Questions per visitor per hour on /api/ask. */
export function getRateLimitPerHour(): number {
  const parsed = Number.parseInt(process.env["RATE_LIMIT_PER_HOUR"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/** How long conversations, and unapproved visitor questions, are kept. */
export function getRetentionDays(): number {
  const parsed = Number.parseInt(process.env["CONVERSATION_RETENTION_DAYS"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}

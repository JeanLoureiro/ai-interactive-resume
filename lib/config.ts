import { z } from "zod";

/** Published Anthropic list prices, USD per million tokens. Used to turn real token counts from
 *  `response.usage` into a real cost per question — the brief asks for a measured number, not an
 *  estimate, so this only ever multiplies tokens the API actually reported. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

export const DEFAULT_MODEL = "claude-sonnet-5";

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = PRICING[model];
  // An unknown model returns 0 rather than guessing a price. A fabricated cost figure in a report
  // about a system built to not fabricate would be a poor look, and a zero is obviously wrong.
  if (!rates) return 0;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

export function isPricedModel(model: string): boolean {
  return model in PRICING;
}

export function getModel(): string {
  return process.env["ANTHROPIC_MODEL"] || DEFAULT_MODEL;
}

export function getTopK(): number {
  const raw = process.env["RETRIEVAL_TOP_K"];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function getApiKey(): string {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key — see the README.",
    );
  }
  return key;
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

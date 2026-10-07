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

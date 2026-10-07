/**
 * Scores eval/dataset.jsonl against the real pipeline and writes eval/results/<model>.json.
 *
 *   pnpm eval                                # default model
 *   pnpm eval --model claude-haiku-4-5       # comparison run
 *   pnpm eval --limit 3                      # smoke test before spending a full run
 *
 * The dataset and its pass bars were committed before any results existed — see the commit history.
 * Automatic metrics are computed here; answer correctness is graded by hand into
 * eval/manual-verdicts.json, because at N=24 a person reading 24 short answers is both faster and
 * more trustworthy than building and calibrating a judge. docs/evaluation.md argues that properly.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ask } from "../lib/pipeline";
import { DEFAULT_MODEL, isPricedModel } from "../lib/config";

const CaseSchema = z.object({
  id: z.string(),
  category: z.enum(["direct", "multi_source", "ambiguous", "unanswerable", "adversarial"]),
  question: z.string(),
  goldSourceIds: z.array(z.string()),
  mustContain: z.array(z.string()),
  mustNotClaim: z.array(z.string()),
  expectsRefusal: z.boolean(),
  expectsConflict: z.string().nullable(),
  note: z.string(),
});
type EvalCase = z.infer<typeof CaseSchema>;

interface CaseResult {
  id: string;
  category: EvalCase["category"];
  question: string;
  status: string;
  answerText: string;
  citedSourceIds: string[];
  rankedSourceIds: string[];
  retrievedSourceIds: string[];
  conflictsSurfaced: string[];
  /** Ids the guard rejected. Without these a guard rejection is unexplainable after the fact —
   *  found missing while doing the error analysis this file exists to support. */
  invalidSourceIds: string[];
  /** Automatic checks. Correctness is not among them — that is graded by hand. */
  checks: {
    citationValid: boolean;
    refusedAsExpected: boolean | null;
    mustNotClaimViolations: string[];
    mustContainMissing: string[];
    goldRetrieved: boolean | null;
    conflictSurfaced: boolean | null;
  };
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(1)}% (${numerator}/${denominator})`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modelIndex = args.indexOf("--model");
  const model = modelIndex >= 0 ? args[modelIndex + 1] : DEFAULT_MODEL;
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number.parseInt(args[limitIndex + 1] ?? "", 10) : Number.NaN;

  if (!model) throw new Error("--model needs a value");
  if (!isPricedModel(model)) {
    console.warn(`! ${model} has no price in lib/config.ts, so cost will report as $0.00000.\n`);
  }

  const raw = await readFile(path.join(process.cwd(), "eval", "dataset.jsonl"), "utf8");
  const allCases = raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => CaseSchema.parse(JSON.parse(line)));
  const cases = Number.isFinite(limit) ? allCases.slice(0, limit) : allCases;

  console.log(`Running ${cases.length} cases against ${model}\n`);
  const results: CaseResult[] = [];

  // Sequential on purpose. Running these concurrently would contend for the same rate limit and
  // inflate the per-question latency we are trying to measure.
  for (const testCase of cases) {
    const response = await ask(testCase.question, { model });
    const answerLower = response.answerText.toLowerCase();
    const citedSourceIds = [
      ...new Set(response.claims.flatMap((claim) => claim.sources.map((s) => s.id))),
    ];
    const rankedSourceIds = response.retrieved.map((unit) => unit.id);

    const result: CaseResult = {
      id: testCase.id,
      category: testCase.category,
      question: testCase.question,
      status: response.status,
      answerText: response.answerText,
      citedSourceIds,
      rankedSourceIds,
      retrievedSourceIds: rankedSourceIds,
      conflictsSurfaced: response.conflicts.map((c) => c.id),
      invalidSourceIds: response.diagnostics.invalidSourceIds,
      checks: {
        // The guard fails closed, so a rejection is exactly the observable signal that the model
        // tried to cite something it was not given.
        citationValid: response.status !== "guard_rejected",
        refusedAsExpected: testCase.expectsRefusal
          ? response.status === "insufficient_context"
          : null,
        mustNotClaimViolations: testCase.mustNotClaim.filter((phrase) =>
          answerLower.includes(phrase.toLowerCase()),
        ),
        mustContainMissing: testCase.mustContain.filter(
          (phrase) => !answerLower.includes(phrase.toLowerCase()),
        ),
        goldRetrieved:
          testCase.goldSourceIds.length > 0
            ? testCase.goldSourceIds.some((id) => rankedSourceIds.includes(id))
            : null,
        conflictSurfaced: testCase.expectsConflict
          ? response.conflicts.some((c) => c.id === testCase.expectsConflict)
          : null,
      },
      latencyMs: response.diagnostics.latencyMs,
      inputTokens: response.diagnostics.inputTokens,
      outputTokens: response.diagnostics.outputTokens,
      costUsd: response.diagnostics.costUsd,
    };
    results.push(result);

    const flags = [
      result.checks.citationValid ? "" : "GUARD",
      result.checks.mustNotClaimViolations.length > 0 ? "MUST-NOT-CLAIM" : "",
      result.checks.refusedAsExpected === false ? "NO-REFUSAL" : "",
      result.checks.goldRetrieved === false ? "RECALL" : "",
      result.checks.conflictSurfaced === false ? "CONFLICT" : "",
      result.checks.mustContainMissing.length > 0 ? `MISSING:${result.checks.mustContainMissing.join("|")}` : "",
    ].filter(Boolean);

    console.log(
      `  ${testCase.id.padEnd(3)} ${result.status.padEnd(21)} ${String(result.latencyMs).padStart(6)}ms  ${flags.join(" ") || "ok"}`,
    );
  }

  const answered = results.filter((r) => r.status !== "provider_error");
  const refusalCases = results.filter((r) => r.checks.refusedAsExpected !== null);
  const recallCases = results.filter((r) => r.checks.goldRetrieved !== null);
  const conflictCases = results.filter((r) => r.checks.conflictSurfaced !== null);
  const latencies = results.map((r) => r.latencyMs);
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const violations = results.filter((r) => r.checks.mustNotClaimViolations.length > 0);

  const summary = {
    model,
    ranAt: new Date().toISOString(),
    cases: results.length,
    citationValidity: {
      passed: answered.filter((r) => r.checks.citationValid).length,
      total: answered.length,
    },
    refusalCorrectness: {
      passed: refusalCases.filter((r) => r.checks.refusedAsExpected).length,
      total: refusalCases.length,
    },
    mustNotClaimViolations: { count: violations.length, ids: violations.map((r) => r.id) },
    retrievalRecall: {
      passed: recallCases.filter((r) => r.checks.goldRetrieved).length,
      total: recallCases.length,
    },
    conflictSurfacing: {
      passed: conflictCases.filter((r) => r.checks.conflictSurfaced).length,
      total: conflictCases.length,
    },
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    cost: { totalUsd: totalCost, perQuestionUsd: totalCost / (results.length || 1) },
  };

  console.log("\n─────────────────────────────────────────────────────────");
  console.log(`METRIC                    RESULT                    BAR`);
  console.log("─────────────────────────────────────────────────────────");
  console.log(`Citation validity         ${pct(summary.citationValidity.passed, summary.citationValidity.total).padEnd(25)} 100%`);
  console.log(`Refusal correctness       ${pct(summary.refusalCorrectness.passed, summary.refusalCorrectness.total).padEnd(25)} 100%`);
  console.log(`Retrieval recall@k        ${pct(summary.retrievalRecall.passed, summary.retrievalRecall.total).padEnd(25)} >=90%`);
  console.log(`Conflict surfacing        ${pct(summary.conflictSurfacing.passed, summary.conflictSurfacing.total).padEnd(25)} 100%`);
  console.log(`must-not-claim violations ${String(summary.mustNotClaimViolations.count).padEnd(25)} 0`);
  console.log("─────────────────────────────────────────────────────────");
  console.log(`Latency p50 / p95         ${summary.latencyMs.p50}ms / ${summary.latencyMs.p95}ms`);
  console.log(`Cost per question         $${summary.cost.perQuestionUsd.toFixed(5)}  (run total $${totalCost.toFixed(4)})`);
  console.log("─────────────────────────────────────────────────────────");
  if (summary.mustNotClaimViolations.count > 0) {
    console.log(`\nBUILD-LEVEL FAIL: must-not-claim violated by ${summary.mustNotClaimViolations.ids.join(", ")}`);
  }
  console.log("\nAnswer correctness is graded by hand — see docs/evaluation.md.");

  const outDir = path.join(process.cwd(), "eval", "results");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${model}.json`);
  await writeFile(outFile, `${JSON.stringify({ summary, results }, null, 2)}\n`, "utf8");
  console.log(`\nFull transcripts -> ${path.relative(process.cwd(), outFile)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

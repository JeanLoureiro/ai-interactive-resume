/**
 * Ask one question from the terminal.
 *
 *   pnpm ask "What did Jean do at KPMG?"
 *   pnpm ask --model claude-haiku-4-5 "Where does Jean work now?"
 *
 * Exists so the pipeline can be exercised without the browser, and because showing sources as plain
 * text is the clearest way to check grounding while building.
 */
import { ask } from "../lib/pipeline";

const STATUS_LABEL: Record<string, string> = {
  answered: "ANSWERED",
  insufficient_context: "NO SOURCED ANSWER",
  guard_rejected: "REJECTED BY CITATION GUARD",
  provider_error: "MODEL API UNAVAILABLE",
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modelIndex = args.indexOf("--model");
  const hasModel = modelIndex >= 0;
  const model = hasModel ? args[modelIndex + 1] : undefined;
  const question = args
    .filter((_, i) => !hasModel || (i !== modelIndex && i !== modelIndex + 1))
    .join(" ")
    .trim();

  if (!question) {
    console.error('Usage: pnpm ask [--model <id>] "<question>"');
    process.exit(1);
  }

  const response = await ask(question, model ? { model } : {});
  const { diagnostics: d } = response;

  console.log(`\n${STATUS_LABEL[response.status] ?? response.status}\n`);
  console.log(response.answerText);

  if (response.claims.length > 0) {
    console.log("\nCLAIMS AND SOURCES");
    for (const claim of response.claims) {
      console.log(`  • ${claim.text}`);
      for (const source of claim.sources) {
        console.log(`      ${source.id}  [${source.source}] ${source.title}`);
      }
    }
  }

  if (response.conflicts.length > 0) {
    console.log(`\nKNOWN DISAGREEMENTS SURFACED: ${response.conflicts.map((c) => c.id).join(", ")}`);
  }

  console.log(`\nRETRIEVED (${response.retrieved.length})`);
  console.log(response.retrieved.map((u) => `  ${u.id}`).join("\n"));

  if (d.invalidSourceIds.length > 0) {
    console.log(`\nINVALID CITATIONS REJECTED: ${d.invalidSourceIds.join(", ")}`);
  }

  console.log(
    `\n${d.model} | ${d.latencyMs}ms | ${d.inputTokens} in / ${d.outputTokens} out | $${d.costUsd.toFixed(5)}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

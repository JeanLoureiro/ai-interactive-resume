/**
 * Runs a resume through the ingest pipeline and prints what would be stored. Writes nothing.
 *
 *   pnpm resume:preview ./resume.pdf
 *   pnpm resume:preview ./resume.pdf --json units.json   # also save the units for inspection
 */
import { readFile, writeFile } from "node:fs/promises";
import { getResumeModel } from "../lib/config";
import { getLlmProvider } from "../lib/llm";
import { formatFromName } from "../lib/resume/extract";
import { formatReport, resumeToUnits } from "../lib/resume";

async function main(): Promise<void> {
  const [file, flag, jsonPath] = process.argv.slice(2);
  if (!file) {
    console.error("Usage: pnpm resume:preview <resume.pdf|.docx|.md> [--json out.json]");
    process.exitCode = 1;
    return;
  }
  const result = await resumeToUnits(new Uint8Array(await readFile(file)), formatFromName(file), {
    provider: getLlmProvider,
    model: getResumeModel(),
    retrievedAt: new Date().toISOString().slice(0, 10),
  });

  for (const unit of result.units) {
    const dates = unit.dateStart ? ` [${unit.dateStart} .. ${unit.dateEnd ?? "present"}]` : "";
    console.log(`\n${unit.id}  (${unit.unitType})${dates}${unit.employer ? `  employer: ${unit.employer}` : ""}`);
    console.log(unit.text.replace(/^/gm, "    "));
  }
  console.log(`\n${formatReport(result)}`);
  if (flag === "--json" && jsonPath) await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

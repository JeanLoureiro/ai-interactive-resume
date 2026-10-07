import { readFile } from "node:fs/promises";
import path from "node:path";
import { getResumeModel } from "../config";
import { getLlmProvider } from "../llm";
import type { KnowledgeUnit } from "../models";
import { formatFromName } from "../resume/extract";
import { formatReport, resumeToUnits } from "../resume";
import type { SourceAdapter } from "./types";

/**
 * The resume file to ingest. Defaults to the worked example's format-contract Markdown CV.
 * Lives here, not in lib/config.ts, because only the ingest script reads files by path; keeping it
 * out of the app's import graph stops the bundler tracing a path built from an env var.
 */
export function getResumePath(): string {
  return path.resolve(process.env["RESUME_PATH"]?.trim() || path.join("knowledge", "sources", "cv.md"));
}

/** `resumePath` comes from RESUME_PATH: a .pdf, .docx, or .md file (format-contract or free-form). */
export const createResumeAdapter = (resumePath: string): SourceAdapter => ({
  name: "cv",
  description: `Resume at ${path.relative(process.cwd(), resumePath)}`,

  async load(): Promise<KnowledgeUnit[]> {
    const result = await resumeToUnits(new Uint8Array(await readFile(resumePath)), formatFromName(resumePath), {
      provider: getLlmProvider,
      model: getResumeModel(),
      retrievedAt: new Date().toISOString().slice(0, 10),
    });
    console.log(formatReport(result).replace(/^/gm, "            ").trimStart());
    return result.units;
  },
});

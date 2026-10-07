import { readFile } from "node:fs/promises";
import path from "node:path";
import { getModel } from "../config";
import { getLlmProvider } from "../llm";
import type { KnowledgeUnit } from "../models";
import { formatFromName } from "../resume/extract";
import { formatReport, resumeToUnits } from "../resume";
import type { SourceAdapter } from "./types";

/** `resumePath` comes from RESUME_PATH: a .pdf, .docx, or .md file (format-contract or free-form). */
export const createResumeAdapter = (resumePath: string): SourceAdapter => ({
  name: "cv",
  description: `Resume at ${path.relative(process.cwd(), resumePath)}`,

  async load(): Promise<KnowledgeUnit[]> {
    const result = await resumeToUnits(new Uint8Array(await readFile(resumePath)), formatFromName(resumePath), {
      provider: getLlmProvider,
      model: getModel(),
      retrievedAt: new Date().toISOString().slice(0, 10),
    });
    console.log(formatReport(result).replace(/^/gm, "            ").trimStart());
    return result.units;
  },
});

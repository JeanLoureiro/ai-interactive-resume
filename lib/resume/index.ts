import type { LlmProvider } from "../llm";
import type { KnowledgeUnit } from "../models";
import { entryToUnit, isContractMarkdown, parseContractMarkdown, type ResumeEntry } from "../sources/cv";
import { extractResumeText, type ResumeFormat } from "./extract";
import { checkFragment, checkHeading, indexSource, type SourceIndex } from "./guard";
import { scrubContactDetails } from "./scrub";
import { structureResume, type ResumeStructure } from "./structure";

export interface DroppedFragment {
  /** The entry it belonged to, or "header". */
  entry: string;
  field: "title" | "employer" | "dates" | "link" | "line" | "headline" | "location" | "profile link";
  text: string;
  /** Words the source does not contain. Empty means it failed on similarity instead. */
  missing: string[];
  similarity: number;
}

export interface ResumeReport {
  path: "format-contract" | "model";
  dropped: DroppedFragment[];
  removedContacts: { emails: number; phones: number };
  model?: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ResumeResult {
  units: KnowledgeUnit[];
  report: ResumeReport;
}

export interface ResumeDeps {
  /** Lazy, so a format-contract Markdown CV ingests with no API key at all. */
  provider: () => LlmProvider;
  model: string;
  retrievedAt: string;
}

const PROFILE_TITLE = "CV header — name, title, location and public handles";

/**
 * Model output -> knowledge units, keeping only what the guard can find in the source.
 *
 * Pure, so the guard's decisions are testable with a stub structure and no model call. A failed
 * sentence is dropped on its own; an entry loses its title or all of its lines only when nothing
 * about it can be verified.
 */
export function structureToUnits(
  structure: ResumeStructure,
  source: SourceIndex,
  retrievedAt: string,
): { units: KnowledgeUnit[]; dropped: DroppedFragment[] } {
  const units: KnowledgeUnit[] = [];
  const dropped: DroppedFragment[] = [];
  const verified = (entry: string, field: DroppedFragment["field"], text: string | undefined) => {
    if (!text?.trim()) return undefined;
    const check = field === "title" ? checkHeading(text, source) : checkFragment(text, source);
    if (check.ok) return text.trim();
    dropped.push({ entry, field, text, missing: check.missing, similarity: check.similarity });
    return undefined;
  };

  const headline = verified("header", "headline", structure.headline);
  const location = verified("header", "location", structure.location);
  const links = structure.profileLinks.map((link) => verified("header", "profile link", link)).filter(Boolean);
  const header = [
    headline ? `Title: ${headline}` : undefined,
    location ? `Location: ${location}` : undefined,
    ...links.map((link) => `Profile: ${link}`),
  ].filter(Boolean);
  if (header.length > 0) {
    header.push("Contact details: removed from this knowledge base by design.");
    units.push({ id: "cv:profile", source: "cv", unitType: "profile", title: PROFILE_TITLE, text: header.join("\n\n"), retrievedAt });
  }

  const usedIds = new Set(units.map((unit) => unit.id));
  for (const { section, entries } of structure.sections) {
    for (const entry of entries) {
      const title = verified(entry.title, "title", entry.title);
      if (!title) continue;
      const lines = entry.lines.map((line) => verified(title, "line", line)).filter((line): line is string => Boolean(line));
      if (lines.length === 0) continue;
      const employer = verified(title, "employer", entry.employer);
      const dates = verified(title, "dates", entry.dates);
      const link = verified(title, "link", entry.link);
      const resumeEntry: ResumeEntry = {
        title,
        section,
        body: lines.join("\n"),
        ...(employer ? { employer } : {}),
        ...(dates ? { dates } : {}),
        ...(link ? { link } : {}),
      };
      const unit = entryToUnit(resumeEntry, retrievedAt);
      // Two entries with the same heading get -2, -3 in order, rather than failing the ingest.
      let id = unit.id;
      for (let n = 2; usedIds.has(id); n++) id = `${unit.id}-${n}`;
      usedIds.add(id);
      units.push({ ...unit, id });
    }
  }
  return { units, dropped };
}

/** Any supported resume file -> knowledge units plus a report of every decision the guard made. */
export async function resumeToUnits(bytes: Uint8Array, format: ResumeFormat, deps: ResumeDeps): Promise<ResumeResult> {
  if (format === "md") {
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (isContractMarkdown(markdown)) {
      return {
        units: parseContractMarkdown(markdown, deps.retrievedAt),
        report: { path: "format-contract", dropped: [], removedContacts: { emails: 0, phones: 0 }, inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  const scrubbed = scrubContactDetails(await extractResumeText(bytes, format));
  const { structure, inputTokens, outputTokens } = await structureResume(scrubbed.text, deps.provider(), deps.model);
  const { units, dropped } = structureToUnits(structure, indexSource(scrubbed.text), deps.retrievedAt);
  return {
    units,
    report: { path: "model", dropped, removedContacts: scrubbed.removed, model: deps.model, inputTokens, outputTokens },
  };
}

/** Human-readable summary for the terminal. */
export function formatReport(result: ResumeResult): string {
  const { report, units } = result;
  if (report.path === "format-contract") return `${units.length} units, parsed from the format contract (no model).`;
  const lines = [
    `${units.length} units via ${report.model} (${report.inputTokens} in / ${report.outputTokens} out tokens).`,
    `Contact details removed before the model saw the text: ${report.removedContacts.emails} email(s), ${report.removedContacts.phones} phone number(s).`,
    `${report.dropped.length} fragment(s) dropped by the ingest guard${report.dropped.length ? ":" : "."}`,
    ...report.dropped.map(
      (d) =>
        `  - [${d.field}] ${d.entry === d.text ? "" : `${d.entry}: `}"${d.text.slice(0, 90)}${d.text.length > 90 ? "…" : ""}" (${
          d.missing.length ? `not in resume: ${d.missing.join(", ")}` : `similarity ${d.similarity.toFixed(2)}`
        })`,
    ),
  ];
  return lines.join("\n");
}

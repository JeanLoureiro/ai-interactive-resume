import { readFile } from "node:fs/promises";
import path from "node:path";
import type { KnowledgeUnit } from "../models";
import { type SourceAdapter, slugify } from "./types";

const CV_PATH = path.join(process.cwd(), "knowledge", "sources", "cv.md");

/** Section heading -> unit type. A section not listed here is a transcription error, not a default. */
const SECTION_TYPES: Record<string, KnowledgeUnit["unitType"]> = {
  Summary: "summary",
  Skills: "skill",
  Experience: "employment",
  Projects: "project",
  Certificates: "certificate",
};

interface ParsedEntry {
  title: string;
  meta: Map<string, string>;
  body: string;
}

/** Pulls `**Key:** value` lines off the top of an entry, leaving the prose behind. */
function splitMeta(lines: string[]): { meta: Map<string, string>; body: string } {
  const meta = new Map<string, string>();
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (line === "") continue;
    const match = /^\*\*([^:*]+):\*\*\s*(.+)$/.exec(line);
    if (!match) break;
    const [, key, value] = match;
    if (key && value) meta.set(key.trim(), value.trim());
  }
  return { meta, body: lines.slice(i).join("\n").trim() };
}

function parseEntries(sectionBody: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const chunks = sectionBody.split(/^### /m).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const title = lines[0]?.trim();
    if (!title) continue;
    const { meta, body } = splitMeta(lines.slice(1));
    if (body) entries.push({ title, meta, body });
  }
  return entries;
}

/**
 * Dates are taken verbatim from the source or left absent.
 *
 * "2026-01 .. present" -> start 2026-01, no end. An absent date is never filled in by inference —
 * guessing a date is the same class of fabrication as guessing an employer.
 */
function parseDates(raw: string | undefined): { dateStart?: string; dateEnd?: string } {
  if (!raw) return {};
  const [start, end] = raw.split("..").map((s) => s.trim());
  const result: { dateStart?: string; dateEnd?: string } = {};
  if (start) result.dateStart = start;
  if (end && end.toLowerCase() !== "present") result.dateEnd = end;
  return result;
}

export const cvAdapter: SourceAdapter = {
  name: "cv",
  description: "Hand-transcribed CV with contact details redacted before indexing",

  async load(): Promise<KnowledgeUnit[]> {
    const raw = await readFile(CV_PATH, "utf8");
    // The source note is documentation for a human reader, not knowledge about Jean.
    const markdown = raw.replace(/<!--[\s\S]*?-->/g, "");
    const retrievedAt = new Date().toISOString().slice(0, 10);
    const units: KnowledgeUnit[] = [];

    const [preamble = "", ...sectionChunks] = markdown.split(/^## /m);

    // Markdown emphasis is stripped so the model reads "Title: Senior AI Engineer" rather than
    // "**Title:** Senior AI Engineer". It also keeps runs of asterisks out of the corpus entirely,
    // which lets a single test assert that no stored unit contains one — the signature of an
    // ingested LinkedIn-masked value.
    const profileBody = preamble
      .replace(/^#\s+.*$/m, "")
      .replace(/\*\*/g, "")
      .trim();
    if (profileBody) {
      units.push({
        id: "cv:profile",
        source: "cv",
        unitType: "profile",
        title: "CV header — name, title, location and public handles",
        text: profileBody,
        retrievedAt,
      });
    }

    for (const chunk of sectionChunks) {
      const lines = chunk.split("\n");
      const sectionName = lines[0]?.trim() ?? "";
      const unitType = SECTION_TYPES[sectionName];
      if (!unitType) {
        throw new Error(
          `cv.md has an unrecognised section "${sectionName}". Add it to SECTION_TYPES rather than letting it fall through to a default — a silent default would mistype every unit beneath it.`,
        );
      }

      for (const entry of parseEntries(lines.slice(1).join("\n"))) {
        const employer = entry.meta.get("Employer");
        const link = entry.meta.get("Link");
        units.push({
          id: `cv:${slugify(entry.title)}`,
          source: "cv",
          unitType,
          title: entry.title,
          text: entry.body,
          ...(employer ? { employer } : {}),
          ...parseDates(entry.meta.get("Dates")),
          ...(link ? { link } : {}),
          retrievedAt,
        });
      }
    }

    return units;
  },
};

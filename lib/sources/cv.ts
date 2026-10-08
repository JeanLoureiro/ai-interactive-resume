/**
 * The CV format contract (see the comment at the top of knowledge/sources/cv.md) and the one
 * entry -> unit mapping that every resume path shares.
 *
 * A Markdown file in this format is parsed directly, with no model involved. A PDF, DOCX or free-form
 * Markdown resume goes through lib/resume/, which produces the same entries and maps them through
 * `entryToUnit` here, so ids, dates and unit types are decided in exactly one place.
 */
import type { KnowledgeUnit } from "../models";
import { slugify } from "./types";

/** Section heading -> unit type. A section not listed here is a transcription error, not a default. */
export const SECTION_TYPES = {
  Summary: "summary",
  Skills: "skill",
  Experience: "employment",
  Projects: "project",
  Certificates: "certificate",
  Education: "education",
} as const satisfies Record<string, KnowledgeUnit["unitType"]>;

export type SectionName = keyof typeof SECTION_TYPES;

const isSectionName = (name: string): name is SectionName => Object.hasOwn(SECTION_TYPES, name);

/** One `###` entry, whichever path produced it. */
export interface ResumeEntry {
  title: string;
  section: SectionName;
  body: string;
  employer?: string;
  /** As written: "2022-04 .. present", "April 2022 – August 2026". Parsed by `parseDates`. */
  dates?: string;
  link?: string;
}

/** Shared by both paths, so a CV gets the same ids and shapes whether a human or a model split it. */
export function entryToUnit(entry: ResumeEntry, retrievedAt: string): KnowledgeUnit {
  return {
    id: `cv:${slugify(entry.title)}`,
    source: "cv",
    unitType: SECTION_TYPES[entry.section],
    title: entry.title,
    text: entry.body,
    ...(entry.employer ? { employer: entry.employer } : {}),
    ...parseDates(entry.dates),
    ...(entry.link ? { link: entry.link } : {}),
    retrievedAt,
  };
}

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

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "April 2022" / "Apr 2022" -> "2022-04". Anything else is returned as written. */
function normaliseDate(raw: string): string {
  const match = /^([a-z]+)\.?\s+(\d{4})$/i.exec(raw);
  const month = match ? MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase()) : -1;
  return match && month >= 0 ? `${match[2]}-${String(month + 1).padStart(2, "0")}` : raw;
}

/**
 * Dates are taken verbatim from the source or left absent.
 *
 * "2026-01 .. present" -> start 2026-01, no end. "April 2022 – August 2026" -> 2022-04, 2026-08:
 * a month name is converted mechanically, never inferred. An absent date is never filled in —
 * guessing a date is the same class of fabrication as guessing an employer.
 */
export function parseDates(raw: string | undefined): { dateStart?: string; dateEnd?: string } {
  if (!raw) return {};
  const [start, end] = raw.split(/\s*(?:\.\.|–|—|\s-\s|\bto\b)\s*/i).map((s) => s.trim());
  const result: { dateStart?: string; dateEnd?: string } = {};
  if (start) result.dateStart = normaliseDate(start);
  if (end && !/^(present|current|now)$/i.test(end)) result.dateEnd = normaliseDate(end);
  return result;
}

/**
 * True when every `##` heading is a known section and there is at least one `###` entry. Such a
 * file is parsed directly; anything else is treated as a free-form resume and goes to the model.
 */
export function isContractMarkdown(raw: string): boolean {
  const markdown = raw.replace(/<!--[\s\S]*?-->/g, "");
  const sections = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]!.trim());
  return sections.length > 0 && sections.every(isSectionName) && /^### /m.test(markdown);
}

/** Entry metadata kept as text at the top of the unit, in this order. */
const TEXT_META_KEYS = ["Role", "Engagement", "Location", "Status"] as const;

/** Parses a CV written in the format contract. No model, no guard needed: a human wrote it. */
export function parseContractMarkdown(raw: string, retrievedAt: string): KnowledgeUnit[] {
  // The source note is documentation for a human reader, not knowledge about the subject.
  const markdown = raw.replace(/<!--[\s\S]*?-->/g, "");
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
    if (!isSectionName(sectionName)) {
      throw new Error(
        `cv.md has an unrecognised section "${sectionName}". Add it to SECTION_TYPES rather than letting it fall through to a default — a silent default would mistype every unit beneath it.`,
      );
    }

    for (const entry of parseEntries(lines.slice(1).join("\n"))) {
      const employer = entry.meta.get("Employer");
      const dates = entry.meta.get("Dates");
      const link = entry.meta.get("Link");
      // Role, Engagement, Location and Status have no field of their own, so they lead the text.
      // They used to be parsed and then dropped, which hid every project role ("Forward Deployed
      // Engineer") from the assistant.
      const facts = TEXT_META_KEYS.flatMap((key) => {
        const value = entry.meta.get(key);
        return value ? [`${key}: ${value}`] : [];
      });
      units.push(
        entryToUnit(
          {
            title: entry.title,
            section: sectionName,
            body: facts.length > 0 ? `${facts.join("\n")}\n\n${entry.body}` : entry.body,
            ...(employer ? { employer } : {}),
            ...(dates ? { dates } : {}),
            ...(link ? { link } : {}),
          },
          retrievedAt,
        ),
      );
    }
  }

  return units;
}

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildKnowledgeBase, retireDanglingConflicts } from "../lib/knowledge";
import type { Conflict } from "../lib/models";
import { jsonKnowledgeStore } from "../lib/db/knowledge-store";

// The committed snapshot specifically: it is what the no-database demo serves and what ingest writes.
const kb = buildKnowledgeBase(await jsonKnowledgeStore.load());

describe("knowledge base integrity", () => {
  it("loads units and conflicts", () => {
    expect(kb.units.length).toBeGreaterThan(20);
    expect(kb.conflicts.length).toBeGreaterThan(0);
  });

  it("has unique unit ids", () => {
    expect(new Set(kb.units.map((u) => u.id)).size).toBe(kb.units.length);
  });

  // buildKnowledgeBase throws on a dangling reference, so reaching this assertion is itself the
  // result. It is stated explicitly because the failure mode — a conflict that silently stops
  // firing after a unit is renamed — is invisible in the answers.
  it("has no conflict pointing at a missing unit", () => {
    for (const conflict of kb.conflicts) {
      for (const id of conflict.unitIds) {
        expect(kb.byId.has(id), `${conflict.id} -> ${id}`).toBe(true);
      }
    }
  });

  it("covers all three sources", () => {
    expect(new Set(kb.units.map((u) => u.source))).toEqual(new Set(["cv", "linkedin", "github"]));
  });
});

const conflict = (id: string, unitIds: string[]): Conflict => ({
  id,
  kind: "gap",
  unitIds,
  summary: `${id} summary`,
  resolutionNote: `${id} note`,
});

describe("retiring conflicts whose units are gone", () => {
  const units = [{ id: "cv:profile" }, { id: "linkedin:profile" }];

  it("keeps every conflict whose units are all still present, in order", () => {
    const conflicts = [
      conflict("job-title", ["cv:profile", "linkedin:profile"]),
      conflict("education", ["cv:profile"]),
    ];
    const result = retireDanglingConflicts(units, conflicts);
    expect(result.retired).toEqual([]);
    expect(result.kept).toEqual(conflicts);
  });

  it("drops a whole conflict when any of its units is missing", () => {
    const surviving = conflict("job-title", ["cv:profile", "linkedin:profile"]);
    const dangling = conflict("employment", ["cv:kpmg", "linkedin:current-employer"]);
    const result = retireDanglingConflicts(units, [dangling, surviving]);
    expect(result.kept).toEqual([surviving]);
    expect(result.retired).toEqual([
      { conflict: dangling, missingUnitIds: ["cv:kpmg", "linkedin:current-employer"] },
    ]);
  });

  it("retires every conflict when none of their units remain", () => {
    const conflicts = [conflict("education", ["linkedin:education"]), conflict("github", ["github:scope"])];
    const result = retireDanglingConflicts(units, conflicts);
    expect(result.kept).toEqual([]);
    expect(result.retired.map((retired) => retired.conflict.id)).toEqual(["education", "github"]);
  });
});

describe("redaction is structural", () => {
  const CONTACT_PATTERNS: Array<[string, RegExp]> = [
    // Generic shapes rather than the real values: a test that spells out the number it guards
    // against would publish that number itself.
    ["phone number", /\b04\d{2}\s?\d{3}\s?\d{3}\b|\+?61\s?4\d{2}\s?\d{3}\s?\d{3}/],
    // Any bare email, in case one is ever transcribed in.
    ["any email address", /[a-z0-9._%+-]+@(?!example\.)[a-z0-9.-]+\.[a-z]{2,}/i],
  ];

  const corpus = JSON.stringify(kb.units);
  const cvSource = readFileSync(
    path.join(process.cwd(), "knowledge", "sources", "cv.md"),
    "utf8",
  );

  // Asserted against the transcription as well as the index. If PII is absent from the source file
  // it cannot reach anything downstream — that is the whole point of redacting at transcription
  // time rather than filtering at runtime, and this test is what keeps it true.
  for (const [label, pattern] of CONTACT_PATTERNS) {
    it(`keeps ${label} out of the knowledge base`, () => {
      expect(corpus).not.toMatch(pattern);
    });

    it(`keeps ${label} out of the transcribed CV source`, () => {
      expect(cvSource).not.toMatch(pattern);
    });
  }

  it("still keeps the public professional handles, which are the intended contact route", () => {
    expect(corpus).toMatch(/linkedin\.com\/in\/jeanloureiro/i);
    expect(corpus).toMatch(/github\.com\/JeanLoureiro/i);
  });
});

describe("masked LinkedIn values are never stored", () => {
  it("has no unit containing a run of asterisks", () => {
    const masked = kb.units.filter((unit) => /\*{2,}/.test(unit.text) || /\*{2,}/.test(unit.title));
    expect(masked.map((u) => u.id)).toEqual([]);
  });
});

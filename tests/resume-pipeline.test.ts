import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LlmProvider, StructuredRequest } from "../lib/llm/types";
import { resumeToUnits, structureToUnits } from "../lib/resume";
import { indexSource } from "../lib/resume/guard";
import type { ResumeStructure } from "../lib/resume/structure";
import { parseDates } from "../lib/sources/cv";

const RESUME_TEXT = `Ada Lovelace
Lead Engineer
London, UK | +44 20 7946 0958 | ada.lovelace@analytical.co.uk
linkedin.com/in/ada-lovelace
Experience
Analytical Engines Ltd / Lead Engineer | April 2019 – August 2024
I led a team of 6 building the difference engine scheduler.
I cut batch runtime by 40% with a new caching layer.
Education
University of London, BSc Mathematics, 2012 – 2015
`;

const RETRIEVED_AT = "2026-10-07";

/** Stands in for the model: returns a fixed structure and records what it was shown. */
function stubProvider(structure: ResumeStructure) {
  const seen: string[] = [];
  const provider: LlmProvider = {
    name: "stub",
    async generateStructured<T>(request: StructuredRequest<T>) {
      seen.push(request.user);
      return { data: request.schema.parse(structure), inputTokens: 100, outputTokens: 50 };
    },
  };
  return { provider, seen };
}

const honest: ResumeStructure = {
  headline: "Lead Engineer",
  location: "London, UK",
  profileLinks: ["linkedin.com/in/ada-lovelace"],
  sections: [
    {
      section: "Experience",
      entries: [
        {
          title: "Analytical Engines Ltd — Lead Engineer",
          employer: "Analytical Engines Ltd",
          dates: "April 2019 – August 2024",
          lines: [
            "I led a team of 6 building the difference engine scheduler.",
            "I cut batch runtime by 40% with a new caching layer.",
          ],
        },
      ],
    },
    {
      section: "Education",
      entries: [{ title: "University of London — BSc Mathematics", dates: "2012 – 2015", lines: ["University of London, BSc Mathematics, 2012 – 2015"] }],
    },
  ],
};

const source = indexSource(RESUME_TEXT);

describe("structure -> units", () => {
  it("keeps an honest structure whole, with parsed dates and types", () => {
    const { units, dropped } = structureToUnits(honest, source, RETRIEVED_AT);
    expect(dropped).toEqual([]);
    const job = units.find((unit) => unit.id === "cv:analytical-engines-ltd-lead-engineer")!;
    expect(job).toMatchObject({ unitType: "employment", employer: "Analytical Engines Ltd", dateStart: "2019-04", dateEnd: "2024-08" });
    expect(units.find((unit) => unit.unitType === "education")).toMatchObject({ dateStart: "2012", dateEnd: "2015" });
    expect(units.find((unit) => unit.id === "cv:profile")?.text).toMatch(/Title: Lead Engineer/);
  });

  it("drops an inflated number and an invented sentence, keeping the rest of the entry", () => {
    const tampered = structuredClone(honest);
    tampered.sections[0]!.entries[0]!.lines = [
      "I led a team of 60 building the difference engine scheduler.",
      "I cut batch runtime by 40% with a new caching layer.",
      "I hold a PhD in Computer Science from Cambridge.",
    ];
    const { units, dropped } = structureToUnits(tampered, source, RETRIEVED_AT);
    expect(dropped.map((d) => d.text)).toEqual([
      "I led a team of 60 building the difference engine scheduler.",
      "I hold a PhD in Computer Science from Cambridge.",
    ]);
    expect(units.find((unit) => unit.unitType === "employment")?.text).toBe("I cut batch runtime by 40% with a new caching layer.");
  });

  it("drops an entry whose title cannot be verified, and an invented employer field", () => {
    const tampered = structuredClone(honest);
    tampered.sections[0]!.entries[0]!.employer = "Google";
    tampered.sections.push({ section: "Certificates", entries: [{ title: "AWS Solutions Architect", lines: ["Certified 2020"] }] });
    const { units, dropped } = structureToUnits(tampered, source, RETRIEVED_AT);
    expect(units.find((unit) => unit.unitType === "employment")?.employer).toBeUndefined();
    expect(units.some((unit) => unit.unitType === "certificate")).toBe(false);
    expect(dropped.map((d) => d.field)).toEqual(expect.arrayContaining(["employer", "title"]));
  });

  it("gives repeated headings distinct, ordered ids instead of failing", () => {
    const repeated = structuredClone(honest);
    repeated.sections[0]!.entries.push(structuredClone(repeated.sections[0]!.entries[0]!));
    const ids = structureToUnits(repeated, source, RETRIEVED_AT).units.map((unit) => unit.id);
    expect(ids).toContain("cv:analytical-engines-ltd-lead-engineer");
    expect(ids).toContain("cv:analytical-engines-ltd-lead-engineer-2");
  });
});

describe("resume file -> units", () => {
  const deps = (provider: LlmProvider) => ({ provider: () => provider, model: "stub-model", retrievedAt: RETRIEVED_AT });

  it("never shows the model contact details, and drops them if it echoes them anyway", async () => {
    const echoing = structuredClone(honest);
    echoing.profileLinks.push("ada.lovelace@analytical.co.uk", "+44 20 7946 0958");
    const { provider, seen } = stubProvider(echoing);
    const { units, report } = await resumeToUnits(new TextEncoder().encode(RESUME_TEXT), "md", deps(provider));

    expect(seen[0]).not.toMatch(/7946|analytical\.co\.uk/);
    expect(report.removedContacts).toEqual({ emails: 1, phones: 1 });
    expect(JSON.stringify(units)).not.toMatch(/7946|@/);
    expect(report.dropped.filter((d) => d.field === "profile link")).toHaveLength(2);
  });

  it("parses a format-contract Markdown CV without calling a model", async () => {
    const provider = () => {
      throw new Error("the model must not be called for a format-contract CV");
    };
    const markdown = readFileSync(path.join(process.cwd(), "knowledge", "sources", "cv.md"));
    const { units, report } = await resumeToUnits(new Uint8Array(markdown), "md", { provider, model: "x", retrievedAt: RETRIEVED_AT });
    expect(report.path).toBe("format-contract");
    expect(units.length).toBe(23);
  });
});

describe("date parsing", () => {
  it("converts month names mechanically and keeps everything else as written", () => {
    expect(parseDates("2022-04 .. present")).toEqual({ dateStart: "2022-04" });
    expect(parseDates("April 2022 – August 2026")).toEqual({ dateStart: "2022-04", dateEnd: "2026-08" });
    expect(parseDates("Sept 2020 to Current")).toEqual({ dateStart: "2020-09" });
    expect(parseDates("2012 - 2015")).toEqual({ dateStart: "2012", dateEnd: "2015" });
    expect(parseDates("Spring 2020")).toEqual({ dateStart: "Spring 2020" });
  });
});

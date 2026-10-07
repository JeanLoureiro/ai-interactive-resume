import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractResumeText, formatFromName } from "../lib/resume/extract";

// Synthetic resumes for a fictional person; the contact details are fake (UK drama-reserved number).
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "tests", "fixtures", name)));

describe("resume text extraction", () => {
  it.each(["ada-lovelace.pdf", "ada-lovelace.docx"])("reads %s", async (name) => {
    const text = await extractResumeText(fixture(name), formatFromName(name));
    expect(text).toMatch(/Analytical Engines Ltd/);
    expect(text).toMatch(/I led a team of 6 building the difference engine scheduler\./);
    expect(text).toMatch(/BSc Mathematics/);
  });

  it("rejects unsupported file types by name", () => {
    expect(() => formatFromName("resume.pages")).toThrow(/\.pdf, \.docx or \.md/);
  });
});

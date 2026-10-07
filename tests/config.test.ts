import { afterEach, describe, expect, it, vi } from "vitest";
import { describeSources, getSubject } from "../lib/config";
import * as fallback from "../lib/fallback";
import { buildSystemPrompt } from "../lib/generation";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("subject configuration", () => {
  it("fails loudly when SUBJECT_NAME is missing, rather than answering about nobody", () => {
    vi.stubEnv("SUBJECT_NAME", "");
    expect(() => getSubject()).toThrow(/SUBJECT_NAME/);
  });

  it("uses the full name as the short name when none is given", () => {
    vi.stubEnv("SUBJECT_NAME", "Ada Lovelace");
    vi.stubEnv("SUBJECT_SHORT_NAME", "");
    expect(getSubject().shortName).toBe("Ada Lovelace");
  });

  it("treats blank optional profiles as not configured", () => {
    vi.stubEnv("LINKEDIN_PROFILE", "  ");
    vi.stubEnv("GITHUB_USERNAME", "");
    const subject = getSubject();
    expect(subject.linkedinProfile).toBeUndefined();
    expect(subject.githubUsername).toBeUndefined();
  });

  it("rejects a LinkedIn profile that is not a URL", () => {
    vi.stubEnv("LINKEDIN_PROFILE", "jeanloureiro");
    expect(() => getSubject()).toThrow(/LINKEDIN_PROFILE/);
  });

  it("describes only the sources that are configured", () => {
    expect(describeSources({ name: "A", shortName: "A" })).toBe("CV");
    expect(
      describeSources({ name: "A", shortName: "A", githubUsername: "a" }),
    ).toBe("CV and public GitHub repositories");
    expect(
      describeSources({ name: "A", shortName: "A", linkedinProfile: "https://linkedin.com/in/a", githubUsername: "a" }),
    ).toBe("CV, public LinkedIn profile and public GitHub repositories");
  });
});

describe("subject-facing text", () => {
  const texts = () => [
    fallback.nothingRetrieved(),
    fallback.insufficientContext("Not recorded."),
    fallback.providerError(),
    buildSystemPrompt(getSubject()),
  ];

  // A template is used for people it has never met. Gendered pronouns in fixed text would misgender
  // whoever forks it, so the subject is always referred to by name.
  it("never uses gendered pronouns for the subject", () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/\b(he|him|his|she|her|hers)\b/i);
    }
  });

  it("names the configured subject, not a hardcoded one", () => {
    vi.stubEnv("SUBJECT_NAME", "Ada Lovelace");
    vi.stubEnv("SUBJECT_SHORT_NAME", "Ada");
    vi.stubEnv("LINKEDIN_PROFILE", "");
    vi.stubEnv("GITHUB_USERNAME", "");
    for (const text of texts()) {
      expect(text).not.toMatch(/Jean|Loureiro/);
    }
    expect(buildSystemPrompt(getSubject())).toMatch(/^You answer questions about Ada Lovelace/);
    expect(fallback.nothingRetrieved()).toMatch(/Ada's knowledge base/);
  });

  it("points to profile links only when they are configured", () => {
    vi.stubEnv("LINKEDIN_PROFILE", "");
    vi.stubEnv("GITHUB_USERNAME", "");
    expect(fallback.insufficientContext("")).not.toMatch(/linkedin|github/i);

    vi.stubEnv("LINKEDIN_PROFILE", "https://au.linkedin.com/in/ada");
    vi.stubEnv("GITHUB_USERNAME", "ada");
    const text = fallback.insufficientContext("");
    expect(text).toMatch(/au\.linkedin\.com\/in\/ada/);
    expect(text).toMatch(/github\.com\/ada/);
  });
});

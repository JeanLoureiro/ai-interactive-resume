import { describe, expect, it } from "vitest";
import { checkFragment, checkHeading, indexSource } from "../lib/resume/guard";

// Shaped like real extracted PDF text: designed fonts often break ligatures, so "ti" comes back as
// "H", "ft" as "I", "tt" as "]" and "tf" as "k". Real lines must survive that; invented ones must not.
const SOURCE = indexSource(`
Ada Lovelace
Senior Engineer
Summary Senior engineer with 12+ years shipping producHon soIware, now focused on agenHc systems.
Skills Languages: TypeScript, Python, SQL, Node.js, CSS/SASS
Human-in-the-loop approval and escalaHon pa]erns for audit and feedback plakorms.
Experience Analytical Engines Ltd / Lead Engineer | April 2019 – August 2024 | Remote
Built real-Hme authenHcaHon for the payments team.
Cut bundle size through code spliOng.
`);

const kept = (text: string) => expect(checkFragment(text, SOURCE).ok, text).toBe(true);
const dropped = (text: string) => expect(checkFragment(text, SOURCE).ok, text).toBe(false);

describe("ingest guard: real lines survive extraction damage", () => {
  it("keeps lines whose words were broken by ligatures", () => {
    kept("Senior engineer with 12+ years shipping production software, now focused on agentic systems.");
    kept("Human-in-the-loop approval and escalation patterns for audit and feedback platforms.");
    kept("Built real-time authentication for the payments team.");
  });

  it("keeps punctuation-joined terms split differently on each side", () => {
    kept("Languages: TypeScript, Python, SQL, Node.js, CSS/SASS");
  });

  it("tolerates a three-letter ligature collapsing into one character", () => {
    kept("Cut bundle size through code splitting.");
  });

  it("keeps titles, employers and dates built from the source's words", () => {
    kept("Analytical Engines Ltd — Lead Engineer");
    kept("April 2019 – August 2024");
  });
});

describe("ingest guard: invented content is dropped", () => {
  it("drops an invented employer", () => {
    const result = checkFragment("Lead Engineer at Google, managing a team of 40.", SOURCE);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("google");
  });

  it("drops a changed number, however plausible", () => {
    const result = checkFragment("Senior engineer with 15+ years shipping production software.", SOURCE);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("15");
  });

  it("drops one swapped word in an otherwise real sentence", () => {
    dropped("Human-in-the-loop approval and escalation patterns for audit and payroll platforms.");
  });

  it("does not let a ligature allowance turn one real word into another", () => {
    // "tile" is one edit from "time", but not a ligature variant of anything in the source.
    dropped("Built real-tile authentication for the payments team.");
  });

  it("drops real words recombined into an unrelated claim when they read nothing like the source", () => {
    dropped("Payments engines escalation Python feedback lead approval.");
  });
});

describe("headings", () => {
  // A heading is composed by the model from words that are not adjacent in the resume
  // ("Skills — Languages"), so it cannot be held to the similar-passage rule; every word still must exist.
  it("keeps a heading composed from non-adjacent source words", () => {
    expect(checkHeading("Skills — Languages", SOURCE).ok).toBe(true);
    expect(checkHeading("Analytical Engines Ltd — Payments", SOURCE).ok).toBe(true);
  });

  it("accepts the singular or plural of a source word", () => {
    // The resume says "Skills"; a heading for one entry under it reads naturally as "Skill".
    expect(checkHeading("Skill — Languages", SOURCE).ok).toBe(true);
  });

  it("drops a heading containing any word the resume does not", () => {
    const result = checkHeading("Analytical Engines Ltd — Director", SOURCE);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["director"]);
  });
});

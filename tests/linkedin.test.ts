import { afterEach, describe, expect, it, vi } from "vitest";
import { createLinkedinAdapter } from "../lib/sources/linkedin";

const profile = (person: object) =>
  `<html><script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Person", ...person }] })}</script></html>`;

const load = async (person: object) => {
  vi.stubGlobal("fetch", async () => new Response(profile(person)));
  return createLinkedinAdapter("https://www.linkedin.com/in/ada").load();
};

afterEach(() => vi.unstubAllGlobals());

describe("LinkedIn adapter", () => {
  it("records past organisations as employment, never as education", async () => {
    const units = await load({
      alumniOf: [
        { "@type": "Organization", name: "Analytical Engines Ltd", member: { "@type": "OrganizationRole" } },
        { "@type": "EducationalOrganization", name: "University of London", member: { startDate: 2012, endDate: 2015 } },
      ],
    });
    const past = units.find((unit) => unit.title.includes("Analytical Engines Ltd"))!;
    expect(past).toMatchObject({ id: "linkedin:past-organisation-analytical-engines-ltd", unitType: "employment", employer: "Analytical Engines Ltd" });
    expect(past.text).toMatch(/past organisation/i);
    expect(units.find((unit) => unit.unitType === "education")).toMatchObject({ title: "Education: University of London", dateStart: "2012", dateEnd: "2015" });
    expect(units.some((unit) => unit.unitType === "education" && unit.title.includes("Analytical"))).toBe(false);
  });

  it("drops masked organisation names instead of storing asterisks", async () => {
    const units = await load({ alumniOf: [{ "@type": "Organization", name: "********** ****" }] });
    expect(units.some((unit) => unit.title.includes("*"))).toBe(false);
  });

  it("states it when the profile shows no current employer", async () => {
    const units = await load({ worksFor: [], alumniOf: [] });
    expect(units.find((unit) => unit.id === "linkedin:no-current-employer")?.text).toMatch(/no current employer/i);
  });
});

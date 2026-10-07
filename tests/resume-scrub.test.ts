import { describe, expect, it } from "vitest";
import { scrubContactDetails } from "../lib/resume/scrub";

describe("contact detail scrub", () => {
  it("removes emails and phone numbers in common formats", () => {
    const { text, removed } = scrubContactDetails(
      "Gold Coast, QLD | +61 412 345 678 | 0412 345 678 | (07) 5555 1234 | ada.lovelace@analytical.co.uk",
    );
    expect(text).not.toMatch(/412|5555|@/);
    expect(text).toMatch(/Gold Coast, QLD/);
    expect(removed).toEqual({ emails: 1, phones: 3 });
  });

  it("leaves dates, year ranges and counts alone", () => {
    const input = "April 2019 – August 2024. 2015-2017. Cohorts 2015 2016 2017 2018. 15+ years, 40 engineers.";
    const { text, removed } = scrubContactDetails(input);
    expect(text).toBe(input);
    expect(removed).toEqual({ emails: 0, phones: 0 });
  });
});

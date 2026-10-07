import type { KnowledgeUnit } from "../models";
import { type SourceAdapter, slugify } from "./types";

/** A logged-out request renders a real browser UA differently from a bare client. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/**
 * LinkedIn masks most fields for logged-out visitors, replacing characters with runs of asterisks
 * ("****** ******** ********") while leaving the first entry of each list readable.
 *
 * Ingesting a masked value would put literal asterisks into the knowledge base and let the model
 * treat them as a fact it could cite. Everything masked is dropped, and the gap is recorded as a
 * gap. This is the same discipline as refusing to infer a missing date: an unreadable field is
 * unknown, not empty and not guessable.
 */
function isMasked(value: string): boolean {
  return /\*{2,}/.test(value);
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || isMasked(trimmed)) return undefined;
  return trimmed;
}

interface PersonNode {
  "@type"?: string;
  name?: unknown;
  description?: unknown;
  address?: { addressLocality?: unknown };
  worksFor?: unknown[];
  alumniOf?: unknown[];
}

function findPerson(payload: unknown): PersonNode | undefined {
  const graph =
    typeof payload === "object" && payload !== null && "@graph" in payload
      ? (payload as { "@graph": unknown[] })["@graph"]
      : [payload];
  return graph.find(
    (node): node is PersonNode =>
      typeof node === "object" && node !== null && (node as PersonNode)["@type"] === "Person",
  );
}

/** `profileUrl` comes from LINKEDIN_PROFILE. Not configured means this adapter is never built. */
export const createLinkedinAdapter = (profileUrl: string): SourceAdapter => ({
  name: "linkedin",
  description: `Public LinkedIn profile (${profileUrl}), logged-out view — most fields are masked by LinkedIn`,

  async load(): Promise<KnowledgeUnit[]> {
    const response = await fetch(profileUrl, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      throw new Error(`LinkedIn returned ${response.status}`);
    }

    const html = await response.text();
    const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    if (!match?.[1]) {
      throw new Error("No JSON-LD block found — LinkedIn changed its public markup");
    }

    const person = findPerson(JSON.parse(match[1]));
    if (!person) {
      throw new Error("JSON-LD contained no Person node");
    }

    const retrievedAt = new Date().toISOString().slice(0, 10);
    const units: KnowledgeUnit[] = [];

    const headline = clean(person.description);
    const locality = clean(person.address?.addressLocality);
    if (headline || locality) {
      units.push({
        id: "linkedin:profile",
        source: "linkedin",
        unitType: "profile",
        title: "LinkedIn profile headline and location",
        text: [
          headline ? `Headline: ${headline}` : undefined,
          locality ? `Location: ${locality}` : undefined,
          "Note: LinkedIn truncates the public headline. The text above is exactly what the logged-out profile shows.",
        ]
          .filter(Boolean)
          .join("\n"),
        retrievedAt,
      });
    }

    // Only the first employer is unmasked publicly. LinkedIn presents it as the current role, which
    // is the crux of the known conflict with the CV — recorded verbatim, resolved in conflicts.json.
    const employer = (person.worksFor ?? [])
      .map((entry) => clean((entry as { name?: unknown } | null)?.name))
      .find((name): name is string => Boolean(name));
    if (employer) {
      units.push({
        id: "linkedin:current-employer",
        source: "linkedin",
        unitType: "employment",
        title: "Employer shown on the public LinkedIn profile",
        text: `The public LinkedIn profile lists ${employer} as the employer, with no end date shown, which LinkedIn renders as the current position. Retrieved ${retrievedAt}. LinkedIn masks every other employer entry for logged-out visitors, so the remainder of the work history is not readable from this source.`,
        employer,
        retrievedAt,
      });
    }

    for (const entry of person.alumniOf ?? []) {
      const record = entry as { name?: unknown; member?: { startDate?: unknown; endDate?: unknown } } | null;
      const name = clean(record?.name);
      if (!name) continue; // masked institution — unknown, not empty
      const start = record?.member?.startDate;
      const end = record?.member?.endDate;
      units.push({
        id: `linkedin:education-${slugify(name)}`,
        source: "linkedin",
        unitType: "education",
        title: `Education: ${name}`,
        text: `${name}${typeof start === "number" ? `, ${start}` : ""}${typeof end === "number" ? `–${end}` : ""}. Listed on the public LinkedIn profile. The CV contains no education section, so this source is the only record of it.`,
        ...(typeof start === "number" ? { dateStart: String(start) } : {}),
        ...(typeof end === "number" ? { dateEnd: String(end) } : {}),
        retrievedAt,
      });
    }

    units.push({
      id: "linkedin:masking-limitation",
      source: "linkedin",
      unitType: "profile",
      title: "What this LinkedIn source cannot see",
      text: `LinkedIn serves logged-out visitors a partially masked profile: past employers beyond the first, most role descriptions, and most job titles are replaced with runs of asterisks. This ingestion deliberately discards masked values rather than storing them, so the absence of a LinkedIn record for a role is not evidence that the role does not exist — the CV is the fuller source for work history. Retrieved ${retrievedAt}.`,
      retrievedAt,
    });

    return units;
  },
});

import type { KnowledgeUnit } from "./models";

/**
 * Every refusal the user sees is one of these strings.
 *
 * They are templates rather than model output on purpose. A generated refusal can invent its own
 * reason — explaining that a fact "isn't in Jean's background" when the real cause was a timeout, or
 * apologising for a gap that does not exist. Since a refusal is read as evidence of absence, the one
 * thing it must never do is guess at why.
 *
 * Each also says what the user can do next, because "I can't answer that" with no route forward is
 * the least useful thing an assistant can say.
 */

const PROFILES = "his public LinkedIn profile (linkedin.com/in/jeanloureiro) or GitHub (github.com/JeanLoureiro)";

export function nothingRetrieved(): string {
  return `Nothing in Jean's knowledge base matches that question, so there is no sourced answer to give. The knowledge base covers his CV, his public LinkedIn profile and his public GitHub repositories — it does not cover personal details, opinions, or anything outside his professional background. If you think this should be answerable, try naming a specific employer, project or technology.`;
}

export function insufficientContext(modelText: string): string {
  // The model's own wording is kept when it declined, because it can say *what* was missing far
  // better than a template can. It is quoted as a statement about the knowledge base, never
  // presented as a fact about Jean.
  const trimmed = modelText.trim();
  const reason = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  return `${reason}This answer is limited to what Jean's CV, public LinkedIn profile and public GitHub repositories record. Where those are silent, the assistant says so rather than guessing. For anything they do not cover, ${PROFILES} is the better route — or just ask Jean.`;
}

export function guardRejected(): string {
  return `The assistant produced an answer that cited sources it was not given, so it was discarded rather than shown.

This is the system failing safe: an answer whose citations cannot be verified is not shown at all, because an unverifiable claim about someone's career is worse than no claim. The sources retrieved for this question are listed below — you can read them directly. Asking the question a different way will usually work.`;
}

export function providerError(): string {
  return `The language model could not be reached, so there is no generated answer for this question.

Nothing about Jean's background has changed — this is a temporary failure of the model API, not a gap in the record. The sources retrieved for your question are listed below and are shown exactly as stored, unsummarised. Please try again in a moment.`;
}

/** Sources are shown on every fallback path, so a failure still returns something readable. */
export function summariseRetrieved(units: KnowledgeUnit[]): string {
  if (units.length === 0) return "";
  return units.map((unit) => `- ${unit.title} (${unit.id})`).join("\n");
}

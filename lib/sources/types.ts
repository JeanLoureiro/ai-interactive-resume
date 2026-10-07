import type { KnowledgeUnit } from "../models";

/**
 * The seam that makes "add a source later" a one-file change.
 *
 * Everything downstream — indexing, retrieval, citation, the guard, the UI — consumes KnowledgeUnit
 * and knows nothing about where a unit came from. A fourth source is a new file implementing this
 * and one line in the adapter list; nothing else moves.
 */
export interface SourceAdapter {
  /** Matches KnowledgeUnit.source and prefixes every id this adapter mints. */
  readonly name: KnowledgeUnit["source"];
  /** Human-readable provenance, shown in docs and in the UI's source list. */
  readonly description: string;
  load(): Promise<KnowledgeUnit[]>;
}

/** Lowercase, hyphenated, punctuation-free — safe to embed in a citation id. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

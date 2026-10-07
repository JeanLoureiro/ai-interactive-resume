/**
 * The ingest guard: every fragment the model returns must be supported by the resume's own text.
 *
 * Two checks, both required, measured on a real resume PDF before this was written:
 *
 * 1. Every word must exist in the source. Numbers and words with no ligature in them must match
 *    exactly. Words containing a ligature (ti, tti, ft, tt, tf, fi, fl, ff, ffi, ffl) may match a
 *    source word where that ligature collapsed into any single character, because designed PDF fonts
 *    often extract "production" as "producHon". This is what catches subtle edits: "15+" for "12+",
 *    "payroll" for "feedback". A plain similarity score cannot, since those score the same as a real
 *    line with ligature damage.
 * 2. Some window of the source must read similarly (normalised edit distance), so real words
 *    shuffled into an unrelated claim are dropped too.
 *
 * Headings are the exception to rule 2 (see checkHeading): the model composes them from words that
 * are not adjacent in the resume, such as "Skills — Languages". Rule 1 still applies in full.
 *
 * Known blind spot, stated rather than hidden: real words recombined into a false claim that still
 * reads like a passage of the source can pass. The owner reviews every ingest's units for that.
 */

/** Longest first. "tti" is real: fonts such as Calibri draw it as one glyph, and it extracts as one. */
const LIGATURES = ["ffi", "ffl", "tti", "ff", "fi", "fl", "ft", "tf", "tt", "ti"];
const MIN_SIMILARITY = 0.8;

export interface SourceIndex {
  /** Every token the source contains, from two tokenisations (see indexSource). */
  vocabulary: Set<string>;
  /** Alphanumeric words in order, for the similarity window. */
  words: string[];
}

export interface FragmentCheck {
  ok: boolean;
  /** Best similarity of any source window, 0 to 1. */
  similarity: number;
  /** Words not found in the source, lowercased. */
  missing: string[];
}

const alphanumericWords = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Two tokenisations, unioned. Whitespace tokens keep ligature debris inside one word ("pa]erns"),
 * alphanumeric tokens split "node.js" into "node" and "js" the same way candidate fragments are split.
 */
export function indexSource(text: string): SourceIndex {
  const lower = text.toLowerCase();
  const whitespaceTokens = lower
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""));
  return {
    vocabulary: new Set([...whitespaceTokens, ...alphanumericWords(lower)].filter(Boolean)),
    words: alphanumericWords(lower),
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "time" -> /^(?:ti|.)me$/: the word, with each ligature pair allowed to have collapsed. */
function ligaturePattern(word: string): RegExp | undefined {
  let pattern = "";
  let found = false;
  for (let i = 0; i < word.length; ) {
    const ligature = LIGATURES.find((candidate) => word.startsWith(candidate, i));
    if (ligature) {
      pattern += `(?:${ligature}|.)`;
      i += ligature.length;
      found = true;
    } else {
      pattern += escapeRegExp(word[i]!);
      i += 1;
    }
  }
  return found ? new RegExp(`^${pattern}$`) : undefined;
}

function wordInSource(word: string, index: SourceIndex): boolean {
  if (index.vocabulary.has(word)) return true;
  if (/\d/.test(word)) return false;
  // Singular or plural of a source word: "Certificate" under a "Certificates" heading.
  if (index.vocabulary.has(`${word}s`) || (word.endsWith("s") && index.vocabulary.has(word.slice(0, -1)))) return true;
  const pattern = ligaturePattern(word);
  if (!pattern) return false;
  for (const token of index.vocabulary) {
    if (token.length < word.length - 2 || token.length > word.length) continue;
    if (pattern.test(token)) return true;
  }
  return false;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

function bestWindowSimilarity(words: string[], index: SourceIndex): number {
  const fragment = words.join(" ");
  const fragmentWords = new Set(words);
  let best = 0;
  for (let start = 0; start + words.length <= index.words.length; start++) {
    const window = index.words.slice(start, start + words.length);
    // Cheap pre-filter: a window sharing under a third of the words cannot reach the threshold.
    if (window.filter((word) => fragmentWords.has(word)).length * 3 < words.length) continue;
    const text = window.join(" ");
    const similarity = 1 - editDistance(fragment, text) / Math.max(fragment.length, text.length);
    if (similarity > best) best = similarity;
    if (best === 1) break;
  }
  return best;
}

const missingWords = (words: string[], index: SourceIndex) => [...new Set(words.filter((word) => !wordInSource(word, index)))];

/** For content: every word in the source, and a similar passage somewhere in it. */
export function checkFragment(fragment: string, index: SourceIndex): FragmentCheck {
  const words = alphanumericWords(fragment);
  if (words.length === 0) return { ok: false, similarity: 0, missing: [] };
  const missing = missingWords(words, index);
  const similarity = missing.length === 0 ? bestWindowSimilarity(words, index) : 0;
  return { ok: missing.length === 0 && similarity >= MIN_SIMILARITY, similarity, missing };
}

/** For headings the model composes: every word must be in the source; adjacency is not required. */
export function checkHeading(heading: string, index: SourceIndex): FragmentCheck {
  const words = alphanumericWords(heading);
  const missing = missingWords(words, index);
  return { ok: words.length > 0 && missing.length === 0, similarity: missing.length === 0 ? 1 : 0, missing };
}

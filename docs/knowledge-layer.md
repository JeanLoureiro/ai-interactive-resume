# The knowledge layer

What the assistant can see, how it got there, and what it does when the sources disagree.

## What the assistant can see

43 knowledge units. `pnpm ingest` always writes them to `data/knowledge-units.json`, and with
`DATABASE_URL` set it also replaces the `knowledge_units` and `conflicts` tables with the same data,
in one transaction. Either way, read that file and you know exactly what the assistant knows. There
is no embedding it can reach and no live lookup at question time.

| Source | Units | How it is collected |
| --- | ---: | --- |
| CV | 23 | Hand-transcribed to `knowledge/sources/cv.md`, parsed by `lib/sources/cv.ts` |
| LinkedIn | 4 | Live HTML fetch of the public profile, JSON-LD extracted |
| GitHub | 16 | Unauthenticated REST API, one unit per public repo plus a scope unit |

Three sources, three deliberately different ingestion mechanisms — a local document, an HTML
scrape, and a JSON API. That is the point: it demonstrates the adapter seam holds under real
variation rather than asserting that it would.

## The unit of retrieval is the unit of citation

A `KnowledgeUnit` (see `lib/models.ts`) is one retrievable, citable fact-bearing chunk: a job, a
project, a STAR story, a skill group, a repository.

These two things are deliberately the same size. If retrieval worked on paragraphs but citation
worked on documents, "this claim traces to that source" would stop being checkable — you could
never tell whether the cited document actually contained the claim, only that it was nearby.

Each unit carries:

- a **stable id** (`cv:kpmg-harness-engineering-...`) — cited in answers and referenced by eval gold
  labels, so a rebuild must not renumber them
- `unitType` — `employment`, `project`, `skill`, `certificate`, `education`, `profile`, `repository`
- `employer`, `dateStart`, `dateEnd` where the source states them, **absent where it does not**
- `retrievedAt`, so staleness is a visible property rather than a silent one

Units repeat their own employer and dates instead of inheriting them from the surrounding document,
because the model only ever sees the retrieved unit — never the page it came from.

`unitType` is load-bearing, not decoration. It is what lets the system treat an `employment` unit
overlapping a `project` unit as ordinary side work rather than a contradiction, without hoping the
model infers a résumé convention on its own.

## Cleaning and redaction

**Contact details are redacted at transcription time, not at runtime.** The phone number and
personal email are simply absent from `knowledge/sources/cv.md`. They cannot reach the index, the
prompt, or a response, because they do not exist anywhere in the pipeline. A runtime filter could be
bypassed or forgotten; an absent value cannot. Public professional handles (LinkedIn, GitHub) are
kept, because they are the intended contact route and the assistant points at them instead.

**Masked LinkedIn values are discarded, not stored.** LinkedIn serves logged-out visitors a
partially masked profile — past employers beyond the first, most role descriptions and most job
titles are replaced with runs of asterisks, while the first entry of each list stays readable.
Storing `"****** ******** ********"` would hand the model a string it could cite as a fact. The
adapter drops anything masked and records the masking itself as a unit
(`linkedin:masking-limitation`), so the system can say *this source cannot see that* rather than
implying the record is empty.

**Past employers on LinkedIn are not education.** LinkedIn's structured data lists past employers
and schools in the same `alumniOf` list, distinguished only by type: `EducationalOrganization` is a
school, `Organization` an employer. Reading every entry as education once produced "Education: KPMG
Australia". Past employers now become `linkedin:past-organisation-*` employment units, and a
profile with no current employer says so in `linkedin:no-current-employer`.

**Dates are taken verbatim or left absent.** Inferring a missing month is the same class of
fabrication as inferring an employer. Where the CV gives a year with no month (Marketing Triage),
the transcription says so explicitly.

## How retrieval finds context

BM25 over the unit text, top-k (default 5). See `docs/architecture.md` for why lexical retrieval
rather than embeddings, and why retrieval exists at all given the corpus would fit in one prompt.

When a retrieved unit is party to a known conflict, **its counterpart units and the resolution note
are force-included** in the context regardless of their own BM25 score. Without this, a question
about the current employer could retrieve only the CV's KPMG unit, and the model would answer
confidently from one side of a disagreement it never saw.

## Adding a fourth source

One file implementing `SourceAdapter` (`lib/sources/types.ts`), plus one line in
`configuredAdapters()` in `scripts/ingest.ts`. Nothing downstream changes: indexing, retrieval, citation, the guard and the UI
all consume `KnowledgeUnit` and know nothing about where a unit came from.

Two behaviours in `scripts/ingest.ts` exist for maintenance rather than the happy path:

- **A failing adapter keeps its previously-ingested units.** Silently shrinking the knowledge base
  looks exactly like the assistant forgetting things, and nobody notices until an answer is wrong.
- **An unrecognised CV section throws.** A silent default would mistype every unit beneath it.

`pnpm ingest --offline` skips the network adapters and keeps their committed units, so a LinkedIn
outage cannot empty the knowledge base.

Ingest checks the whole knowledge base, including every conflict's unit ids, **before writing
anything**. If a source stops returning a unit that a conflict points at, that conflict is dropped
whole, the retirement is logged with the missing ids, and `data/conflicts.json` is rewritten.
Conflicts whose units are all still present are copied unchanged. A malformed conflict still stops
the ingest, and both the snapshot and the database keep their previous contents.

## Pointing it at someone else

Who the knowledge base is about comes from env, read by `getSubject()` in `lib/config.ts`:

| Variable | Effect |
| --- | --- |
| `SUBJECT_NAME` | Required. Full name, used in the system prompt's first line. Missing means a loud error, never a page about nobody. |
| `SUBJECT_SHORT_NAME` | How the page and fallbacks refer to them. Defaults to `SUBJECT_NAME`. |
| `LINKEDIN_PROFILE` | Full profile URL. Blank means the LinkedIn adapter is not built and the text stops mentioning LinkedIn. |
| `GITHUB_USERNAME` | Blank means the same for GitHub. |

The resume is always a source, read from `RESUME_PATH` (default `knowledge/sources/cv.md`). See
"Resumes as PDF, DOCX or free-form Markdown" below.

Fixed text never uses a pronoun for the subject. A template gets forked by people it has never
met, so it refers to them by name instead of guessing.

`knowledge/sources/github-note.md` is optional. When present, its text is appended verbatim to the
`github:public-footprint-scope` unit. It exists because some statements about a public profile are
judgements only its owner can make ("these are tutorial repos", "the real projects are private"),
and those belong in data the owner writes, not in adapter code.

## Resumes as PDF, DOCX or free-form Markdown

A Markdown file in the format contract (see the top of `knowledge/sources/cv.md`) is parsed by
`lib/sources/cv.ts` with no model involved. Anything else goes through `lib/resume/`:

1. **Extract** the text: `unpdf` for PDF, `mammoth` for DOCX. Deterministic.
2. **Scrub** emails and phone numbers from that text, before anything else sees it.
3. **Structure** it with one model call: sections, entries, lines. The model is told to copy, keep
   the resume's own wording and person ("I built…"), and change nothing except words broken by
   extraction.
4. **Guard** every line and heading against the scrubbed text (`lib/resume/guard.ts`). What fails
   is dropped and reported, never stored.
5. **Map** entries to units with the same function the format-contract parser uses, so ids, dates
   and unit types are decided in one place.

The guard exists because the extracted text is not clean. Designed PDF fonts often break
ligatures: one real resume extracted "production software" as `producHon soIware`, "patterns" as
`pa]erns`, "splitting" with `tti` collapsed into one character. So the check cannot be exact
matching, and a plain similarity score is not enough either: on that resume, "15+ years" changed
to "20+" and "feedback" swapped for "payroll" scored the same as genuine damaged lines.

The rule that works, measured before it was written:

- **Every word must exist in the resume.** Numbers exactly. Other words exactly, as their singular
  or plural, or with one ligature (`ti`, `tti`, `ft`, `tt`, `tf`, `fi`, `fl`, `ff`, `ffi`, `ffl`)
  collapsed into a single character. This is what catches a changed number or one swapped word.
- **Content lines must also read like some passage of the resume** (normalised edit distance of at
  least 0.8 against a window of the same length), so real words shuffled into a new claim fail.
  Headings are exempt from this part, because the model composes them from words that are not
  adjacent, such as `Skills — Languages`.

**Known blind spot:** real words recombined into a false claim that still reads like a passage of
the resume can pass. That is the same class as the answer guard's blind spot, and the answer is
the same: `pnpm resume:preview` shows every unit before anything is stored.

## The conflicts, gaps and stale facts

The brief asks for one. The real material produced six, all genuine — nothing here is synthetic.
They live in `data/conflicts.json` as **data, not prompt text**, so they can be enumerated, asserted
on in tests, and force-included at retrieval time. Ingest retires a conflict whose units are gone.
Loading the knowledge base still throws if a conflict references a unit id that no longer exists:
a dangling reference would silently disable a disclosure, and that must break the build rather than
degrade the answers. Publishing a resume from `/admin` uses that same check and refuses the publish.

| Conflict | What disagrees | What the system does |
| --- | --- | --- |
| `employment-status-stale-on-linkedin` | CV ends KPMG 2026-08; LinkedIn shows it as current | **The headline case.** Says the sources disagree, gives the CV's answer, names LinkedIn as stale |
| `job-title-differs-between-sources` | CV "Senior AI Engineer" vs LinkedIn "Senior Software Engineer…" | Reports both, attributes each to its source, declares neither official |
| `education-absent-from-cv` | CV has no education section; LinkedIn has UQ 2015–2017 | Answers from LinkedIn, notes the CV gap, **never states a degree or field** — no source records one |
| `certifications-differ-between-sources` | CV lists two; LinkedIn's section is unreadable | Treats the CV list as the complete known set |
| `public-github-does-not-evidence-cv-projects` | 15 public repos (2014–2023, mostly course follow-alongs); none is a CV project | States what the profile actually contains, that it is not current work, and offers the private-on-request route |
| `projects-overlap-full-time-employment` | Three projects overlap the KPMG dates | Explains concurrent side work; does not refuse, and does not revise dates to make ranges disjoint |

The first is the one that matters most. A stale fact asserted as current is precisely the failure
class the brief names — the CV equivalent of quoting a balance that was true last month.

## What is synthetic

Nothing. Every unit derives from the CV, the public LinkedIn profile, or the GitHub API. Two
statements are Jean's own position rather than API-derived, and are labelled as such in the unit
text: that the current project repositories are private, and that they can be shared on request.

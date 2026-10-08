# Ask about Jean

A source-grounded assistant that answers interview questions about Jean Loureiro's professional
background — and says so, explicitly, when it cannot ground an answer in a citable source.

Originally built as a take-home exercise for a lead engineer role. "The brief" in these docs refers
to that exercise.

> **The constraint that drives every decision here.** The assistant must never invent
> qualifications, employers, projects or achievements. The brief is explicit that a system
> fabricating an employer is the same failure class as one fabricating a balance. Where this system
> holds that line mechanically, it says so. Where it holds it only by measurement, it says that too —
> see [the guard's blind spot](#what-the-guard-does-not-catch).

## Run it

Requires Node 22+ and `pnpm`. Takes about two minutes.

```bash
pnpm install
cp .env.example .env.local        # then add your ANTHROPIC_API_KEY and SUBJECT_NAME
pnpm dev                          # http://localhost:3000
```

That runs as a read-only demo from the committed JSON snapshot. To run it on Postgres, as a
deployment does:

```bash
docker compose up -d              # local Postgres with pgvector, port 54329
# set DATABASE_URL=postgres://resume:resume@localhost:54329/resume in .env.local
pnpm db:setup                     # create the tables, then ingest into them
```

On a free Supabase project, set `CRON_SECRET` too: `vercel.json` schedules a daily
`/api/cron/keepalive` query so the project is never idle long enough to pause.

Or from the terminal, which shows the same information without the browser:

```bash
pnpm ask "What did Jean do at KPMG?"
pnpm ask "Where does Jean work now?"          # sources disagree — watch it say so
pnpm ask "Does Jean have Kubernetes experience?"   # not in the corpus — watch it refuse
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | The web interface |
| `pnpm ask "<question>"` | One question, answer plus sources, in the terminal |
| `pnpm eval` | Scores the 24-case eval set and writes results |
| `pnpm test` | 40 tests over the guard, fallbacks, redaction, retrieval and config |
| `pnpm ingest` | Rebuilds the knowledge base from every configured source |
| `pnpm ingest --offline` | Rebuilds from the CV only, keeping committed network units |
| `pnpm db:setup` | Applies database migrations, then ingests (needs `DATABASE_URL`) |
| `pnpm db:generate` | Writes a new SQL migration after a schema change in `lib/db/schema.ts` |
| `pnpm eval:retrieval` | Recall@5 for BM25 and hybrid retrieval on every gold case. No model call, $0 |
| `pnpm resume:preview <file>` | Shows the units a resume would produce and every line the guard dropped. Writes nothing |

**You need your own Anthropic API key** (`console.anthropic.com`). A full 24-case evaluation run
costs roughly **$0.30** on Sonnet 5 and **$0.15** on Haiku 4.5. Nothing else in the project needs
credentials — ingestion, retrieval, the guard and the tests all run without one.

## Make it yours

Out of the box this answers about Jean, as a worked example. To point it at someone else:

1. Set `SUBJECT_NAME` (and optionally `SUBJECT_SHORT_NAME`, `LINKEDIN_PROFILE`, `GITHUB_USERNAME`)
   in `.env.local`. A blank LinkedIn or GitHub value skips that source.
2. Point `RESUME_PATH` at your resume: a `.pdf`, `.docx` or `.md` file. Run
   `pnpm resume:preview <file>` first to see exactly what would be stored and which lines the
   ingest guard dropped. Phone numbers and emails are removed before the model sees the text.
   (A `.md` written in the format of `knowledge/sources/cv.md` skips the model entirely.)
3. Delete or rewrite `knowledge/sources/github-note.md` and set `data/conflicts.json` to `[]`.
   Both describe Jean.
4. Run `pnpm ingest` (or `pnpm db:setup` with a database), then `pnpm dev`.

**Updating it later without a terminal:** set `ADMIN_PASSWORD` (and a database) and open `/admin`.
Upload a new resume, review every new, changed and removed unit plus every line the guard dropped,
then publish. The uploaded file is read in memory and never stored. Use a long random password:
failed logins are throttled per server instance, not globally.

The page is prerendered, so after changing `.env` restart `pnpm dev` or rebuild. The eval set in
`eval/dataset.jsonl` is Jean-specific too. Treat it as an example of how to write your own.

## What it knows

43 knowledge units in `data/knowledge-units.json`, committed. Read that file and you know exactly
what the assistant knows.

| Source | Units | Ingestion |
| --- | ---: | --- |
| CV | 23 | Hand-transcribed to `knowledge/sources/cv.md`, contact details removed at that step |
| LinkedIn | 4 | Live fetch of the public profile, JSON-LD extracted |
| GitHub | 16 | Unauthenticated REST API |

Three sources through three deliberately different mechanisms — a local document, an HTML scrape, a
JSON API — because that is what demonstrates the adapter seam holds, rather than asserting it would.

Full detail, including what was redacted and why: **[docs/knowledge-layer.md](docs/knowledge-layer.md)**.

## How it works

```
question ──► BM25 + embeddings, fused (+ conflict partners) ──► Claude (Zod schema)
                                                                   │
                                                          deterministic guard
                                                                   │
                                       ┌───────────────────────────┴──────────────┐
                                 cited answer                          deterministic fallback
```

Retrieval runs in TypeScript before the model call, so there are no tools and no agent loop. The
model returns a structured answer whose schema makes an uncited claim unrepresentable. Then the
guard checks every cited id against the set supplied *for that question* — not against the whole
knowledge base, which is a far weaker check — and fails the response closed if anything does not
match.

Every refusal string is a template, never model output. A generated refusal can invent its own
reason, and since a refusal reads as evidence of absence, the one thing it must never do is guess
why.

Why a pipeline rather than an agent, why retrieval at all when the corpus would fit in one prompt,
the failure-path table, model choice and switch triggers, security and privacy:
**[docs/architecture.md](docs/architecture.md)**.

### What the guard does not catch

The guard catches a citation to a unit the model was never given. It does **not** catch a citation
to a unit that genuinely was supplied, where the claim overstates what the unit says — "built
tax-calculation software" becoming "is a certified financial adviser" passes every mechanical check
in this codebase.

That gap is covered by hand-graded `mustNotClaim` labels in the evaluation (case E3 exists for
exactly it) and reported as a measured rate, not a guarantee. A reviewer who believed the guard were
total would trust this system further than it deserves.

## Sources that disagree

The brief asks for one real conflict, gap or stale fact. The material produced six, all genuine —
nothing here is synthetic. They live in `data/conflicts.json` as data rather than prompt text, so
they can be enumerated, tested, and force-included at retrieval time.

The headline one: **the CV ends the KPMG role in August 2026; the public LinkedIn profile still
shows it as current.** Ask "where does Jean work now?" and the system names the disagreement, gives
the CV's answer, and says which source is stale rather than silently picking a side. A stale fact
asserted as current is the CV equivalent of quoting last month's balance.

The others — a job title that differs between sources, education recorded only on LinkedIn with no
degree stated anywhere, a public GitHub profile of 15 repositories last touched between 2014 and
2023 that matches none of the CV projects, and project dates overlapping full-time employment — are
in [docs/knowledge-layer.md](docs/knowledge-layer.md).

## Evaluation

24 cases across all five required categories, with metrics and pass bars **committed before the
first run** — the commit history is the evidence.

Method, metric definitions, why there is no LLM-as-judge, and what would change if this guarded
money movement instead of a CV: **[docs/evaluation.md](docs/evaluation.md)**.

### Results

| Metric | Bar | Sonnet 5 | Haiku 4.5 |
| --- | --- | --- | --- |
| Citation validity | 100% | **100%** (24/24) | 95.8% (23/24) |
| Answer correctness (hand-graded) | ≥85% | **71.4%** (10/14) | not graded |
| Retrieval recall@5 | ≥90% | **73.3%** (11/15) | 73.3% (11/15) |
| Conflict surfacing | 100% | **100%** (5/5) | 100% (5/5) |
| Refusal correctness | 100% | 75% (6/8) | 75% (6/8) |
| Latency p50 / p95 | report | 7,796 / 17,532 ms | 2,562 / 5,460 ms |
| Cost per question | report | $0.01529 | $0.00403 |

**Two of five bars met.** Answer correctness landed at 71.4% against an 85% bar and retrieval recall
at 73.3% against 90%.

**Zero fabrications across 24 cases on both models.** Every claim made traced to a unit actually
supplied. That is the constraint the system exists to hold, and it held.

Three findings worth the click through to [docs/evaluation.md](docs/evaluation.md):

- **Lexical retrieval fails on vocabulary mismatch, and it caused both correctness failures.** The
  certificate units never use the word "certification"; the summary never uses the word
  "experience". Both questions were answerable, neither was retrieved, and the system confidently
  refused. A wrong refusal is the most expensive failure here — it reads as evidence of absence.
  This is now a *measured* reason to add embeddings rather than a hypothetical one.
- **Every must-not-claim flag was a false positive.** Five on Sonnet, one on Haiku, zero real
  fabrications — the check does substring matching and is blind to negation, so it fires when a
  correct refusal quotes the claim it is refusing. The best behaviour in the entire run (answering a
  question, then disclosing and refusing an injected instruction) scored as five violations. The
  self-review predicted this before the run.
- **The evidence favours switching to Haiku** — it matched Sonnet on refusal, recall and conflict
  surfacing while being ~3× faster and ~3.8× cheaper. The default was deliberately left on Sonnet,
  because correctness was hand-graded on Sonnet only and switching on a partial comparison is the
  kind of unevidenced decision this evaluation exists to prevent.

## Known limitations

- **The guard's blind spot**, above. The most important one.
- **`mustNotClaim` is substring matching**, so it catches obvious phrasings and misses paraphrases —
  "holds a doctorate" would sail past a rule watching for "PhD". A tripwire, not a test.
- **Retrieval is deliberately untuned.** "Can I see your code on GitHub?" does not rank the GitHub
  scope unit into the top 5, because "github" appears in every repo unit and carries little IDF.
  Left in and measured rather than fixed before the eval existed.
- **LinkedIn gives very little.** The public profile is masked for logged-out visitors; only the
  first employer and first education entry are readable. Masked values are discarded rather than
  stored, so this source contributes four units and cannot be made to contribute more without
  authenticating.
- **No caching, no rate limiting.** Both are named in
  [what to do before production](docs/architecture.md#before-production-and-what-breaks-at-100).

## Decisions, cuts and AI use

Five decisions with what was rejected and what settled each, what was cut and why, where AI was used
and what was changed after review, and a self-review:
**[docs/decisions.md](docs/decisions.md)**.

Short version on AI use: this repository was built by Claude Code (Opus 5) from a written plan, with
Jean directing and reviewing. The commit history is the real record — each message states the
reasoning for that step. `docs/decisions.md` lists what did not survive review, including one
factual error that reached a written plan before it was checked.

## Time spent

Started at 9:54am

Finsihed at 12pm

Lunch Break.

Pushed evals and update docs at around 2pm

Sent email right after

## Repository map

```
knowledge/sources/cv.md       redacted transcription — the human-readable source of truth
data/knowledge-units.json     snapshot of what the assistant can see; served when there is no database
data/conflicts.json           known disagreements, as data
lib/sources/                  one adapter per source, behind one interface
lib/db/                       Postgres schema, client and knowledge store
drizzle/                      committed SQL migrations
lib/retrieval.ts              BM25 + conflict force-inclusion
lib/generation.ts             the system prompt and the structured call
lib/guard.ts                  the enforcement point
lib/fallback.ts               every refusal the user can see
lib/pipeline.ts               ask() — the single entry point, used by the UI and the eval alike
eval/dataset.jsonl            24 labelled cases
eval/results/                 committed run output
```

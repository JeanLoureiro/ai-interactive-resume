# ai-interactive-resume

An AI assistant that answers recruiters' questions about your career from your own resume, cites a
source for every claim, and says plainly when the record does not cover something. It never invents
an employer, a qualification or a skill, and where it cannot guarantee that mechanically, the docs
say so and measure it instead.

Built as a template: fill in `.env`, point it at your resume (PDF, DOCX or Markdown), deploy. The
worked example in this repository is its author, Jean Loureiro.

## What it does

- **Grounded answers.** Every claim is tied to the resume, LinkedIn or GitHub record it came from,
  and shown with it. A deterministic guard discards any answer that cites something it was not given.
- **Honest refusals.** "Not recorded" is said as such, never guessed at, and never turned into "did
  not happen".
- **Sources that disagree** are named, with which one is more reliable, instead of silently picking a
  side.
- **Upload a resume** as PDF, DOCX or Markdown in `/admin`. Every line the model extracts is checked
  word by word against the file before it is stored; contact details are removed first.
- **Follow-up questions** remember the conversation, without ever treating an earlier answer as a
  source.
- **Invite-only** by default: you create a code in `/admin`, a recruiter gets 24 hours.
- **Any LLM provider**: Anthropic, or anything with an OpenAI-compatible API.
- **Measured, not claimed**: 40 eval cases, each set committed before the feature it tests.

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
`/api/cron/daily` query so the project is never idle long enough to pause; the same job deletes
conversations older than the retention period.

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

**Conversation memory and suggestions** need a database: follow-up questions then understand the
conversation, and `/admin` lets you curate the suggested questions shown under the question box,
including ones visitors asked, which appear only after you approve them. Without a database each
question stands alone.

**Updating it later without a terminal:** set `ADMIN_PASSWORD` (and a database) and open `/admin`.
Upload a new resume, review every new, changed and removed unit plus every line the guard dropped,
then publish. The uploaded file is read in memory and never stored. Use a long random password:
failed logins are throttled per server instance, not globally.

The page is prerendered, so after changing `.env` restart `pnpm dev` or rebuild. The eval set in
`eval/dataset.jsonl` is Jean-specific too. Treat it as an example of how to write your own.

## Use any provider

Answers and resume structuring go through one small interface (`lib/llm/`), with two adapters:
Anthropic, and anything that speaks OpenAI's Chat Completions format. Set four variables:

| Provider | `LLM_PROVIDER` | `LLM_BASE_URL` | `LLM_STRUCTURED_OUTPUT` | Verified |
| --- | --- | --- | --- | --- |
| Anthropic (default) | `anthropic` | | | full eval, committed |
| OpenAI | `openai-compatible` | `https://api.openai.com/v1` | `json_schema` | pending |
| DeepSeek | `openai-compatible` | `https://api.deepseek.com` | `json_object` | pending |
| Gemini, Groq, OpenRouter, Ollama | `openai-compatible` | the provider's `/v1` URL | depends on the model | untested |

Plus `LLM_API_KEY` and `LLM_MODEL`. Whatever the provider, every reply is validated against the
same schema and the citation guard is the same, so a provider that returns malformed output fails
closed to a template, never to an unchecked answer. A bad key or unknown model is reported as a
configuration error rather than "try again later".

## Access: invites

With a database, the assistant is invite-only (`ACCESS_MODE=invite`, the default). You get in by
signing in to `/admin` with `ADMIN_PASSWORD`. To let a recruiter in, create an invite in `/admin`
and send them the link or the 8-character code:

- it lasts 24 hours from first use, on any device, and an unused invite expires after 14 days;
- you can revoke it at any time, and see how many questions it asked;
- only a hash of the code is stored;
- without a code, visitors see a code box and a link to request access on LinkedIn.

Set `ACCESS_MODE=public` to open it to everyone; questions stay rate-limited per visitor
(`RATE_LIMIT_PER_HOUR`). The no-database demo is always public.

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

## Evaluation

40 cases across direct, multi-source, ambiguous, unanswerable, adversarial, paraphrase and
follow-up questions. Each phase's cases and pass bars were committed before its code; the commit
history shows the order. Latest run, Sonnet 5.5:

| Metric | Bar | Result |
| --- | --- | --- |
| Citation validity | 100% | **40/40** |
| Refusal correctness | 100% | **9/9** |
| Conflict surfacing | 100% | 3/4 |
| Retrieval recall@5 | ≥ 90% | 20/30 |
| Must-not-claim flags | 0 | 4, all refusals quoting the claim they refuse |
| Cost per question | | $0.0144 |

`pnpm eval:retrieval` measures retrieval alone, at no cost. Method, every phase's results, and what
the numbers do not show: **[docs/evaluation.md](docs/evaluation.md)**.

## Known limitations

- **The guard's blind spot**, above. The most important one.
- **Retrieval is the weak link.** Recall@5 is 20/30. Hybrid retrieval beat BM25 by 4 cases when it
  was added, but on the current data the two are level; follow-ups that need date reasoning ("And
  before that?") are missed, and the follow-up rewrite varies from run to run.
- **`mustNotClaim` is substring matching**: blind to negation (every flag so far was a correct
  refusal quoting the claim) and to paraphrase. A tripwire, not a test.
- **LinkedIn gives little.** Logged-out profiles are masked; masked values are discarded, never
  stored.
- **Admin sign-in throttling is per server instance**; a long random `ADMIN_PASSWORD` is the real
  protection. Invite redemption is throttled through the database.

## Repository map

```
knowledge/sources/cv.md       redacted transcription — the human-readable source of truth
data/knowledge-units.json     snapshot of what the assistant can see; served when there is no database
data/conflicts.json           known disagreements, as data
lib/sources/                  one adapter per source, behind one interface
lib/db/                       Postgres schema, client and knowledge store
drizzle/                      committed SQL migrations
lib/retrieval.ts              BM25 + embeddings (RRF) + conflict force-inclusion
lib/embeddings.ts             local embedding model (bge-small, via transformers.js)
lib/resume/                   PDF/DOCX/Markdown resume -> checked units (the ingest guard)
lib/llm/                      provider interface: Anthropic and any OpenAI-compatible API
lib/conversation.ts           follow-up rewriting; history as context, never a source
lib/memory.ts                 conversations, suggested questions, retention
lib/access.ts                 invite codes and the access gate
app/admin/                    the owner's page: resume upload, invites, suggestions
lib/generation.ts             the system prompt and the structured call
lib/guard.ts                  the enforcement point
lib/fallback.ts               every refusal the user can see
lib/pipeline.ts               ask() — the single entry point, used by the UI and the eval alike
eval/dataset.jsonl            40 labelled cases, each set committed before its feature
eval/results/                 committed run output
```

## How this was built

It started as a take-home exercise for a lead engineer role and grew in phases from there, each
planned, measured and committed before the next. The original write-up, and what changed since:
**[docs/origin.md](docs/origin.md)**. Design decisions: **[docs/decisions.md](docs/decisions.md)**,
**[docs/architecture.md](docs/architecture.md)**.

## License

MIT. See [LICENSE](LICENSE).

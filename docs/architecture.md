# Architecture

This is written so a reviewer can predict the system's behaviour without reading every line.

## The shape of it

```
                    ┌──────────── pnpm ingest ────────────┐
  cv.md ─────┐                 ┌─► knowledge-units.json (snapshot)
  LinkedIn ──┼──► adapters ────┤                                    ──► BM25 index
  GitHub ────┘                 └─► Postgres, if DATABASE_URL is set
                    └─────────────────────────────────────┘

  question ──► retrieve top-k (+ conflict partners) ──► Claude (messages.parse)
                                                              │
                                                    deterministic guard
                                                              │
                                    ┌─────────────────────────┴──────────────┐
                              cited answer                        deterministic fallback
```

Ingestion runs offline, never at question time. Its output is always written as a readable
snapshot, so a reviewer can see exactly what the assistant knows. With `DATABASE_URL` set, the app
loads the knowledge base from Postgres. Without it, the app serves the committed snapshot as a
read-only demo, so the repo still runs with nothing but an API key. Both go through one
`KnowledgeStore` interface (`lib/knowledge.ts`) and the same validation, and a test proves they
retrieve identically for every eval question. The knowledge base is loaded once per server
instance, so the database is not on the per-question path. Query time is one deterministic pass.

Who the assistant is about is configuration, not code: `getSubject()` in `lib/config.ts` reads
`SUBJECT_NAME` and the optional profile variables, and the system prompt, fallbacks, adapters and
page are all built from it. See "Pointing it at someone else" in `docs/knowledge-layer.md`.

## Why this architecture

**A structured pipeline, not an agent.** The corpus is 43 short units with no hierarchy and no
structure to explore. An agent that calls a search tool in a loop would spend extra turns, extra
tokens and extra latency rediscovering what one BM25 pass returns immediately, and would add failure
modes — loop bugs, partial tool turns — for no retrieval gain. Agents earn their cost when the
search space is large or the path is unknown. Neither is true here.

**Retrieval, not context stuffing — and this is the interesting one.** The whole corpus is a few
thousand tokens. It would fit in every prompt, so "too big for context" would be a false
justification and a reviewer doing the arithmetic would catch it. Retrieval earns its place for two
honest reasons:

1. **It is what makes the citation guard meaningful.** With stuffing, the strongest check available
   is "the cited id exists somewhere in the knowledge base" — which nearly any plausible-looking id
   passes. With retrieval, the check becomes "the cited id was in the set supplied *for this
   question*", and that is a claim the model cannot satisfy by guessing.
2. **It survives the corpus growing.** The moment a fourth source lands, stuffing stops being free,
   and the fix is a retrieval layer — introduced exactly when the system is largest and the change
   is most expensive.

**BM25, not embeddings.** A secondary decision, not the headline. At 43 units an embedding provider
buys no measurable recall while costing a dependency, a second network call per question, and a
second service that can be down. Interview questions are keyword-dense — "KPMG", "Storybook",
"Supabase", "Scrum" — which is where lexical retrieval is strongest. The retriever is one module
behind one function; swapping it is a contained change if the corpus ever justifies it.

## How retrieval works, concretely

`lib/retrieval.ts`. Standard BM25 (k1 = 1.5, b = 0.75) over each unit's title (indexed twice),
employer, type and body. Tokenisation lowercases, strips punctuation, drops a small stopword list
and does crude singularisation — not a real stemmer, which would be another dependency and another
behaviour to explain for no measurable gain at this size.

The stopword list includes `jean` and `loureiro`. Every question is about Jean, but only one unit
spells his name, so the name had the highest IDF in the index and put that unit in the top 5 for
14 of 15 gold-labelled eval questions. Queries are then expanded through a small symmetric synonym
map (`certification ↔ certificate ↔ certified`, `experience ↔ year`, `lead ↔ led ↔ leading`). Each
entry fixes a vocabulary mismatch the eval measured, not a guess, because every entry trades
precision for recall.

Top-k defaults to 5. Then **conflict force-inclusion**: if a retrieved unit is party to a known
disagreement (`data/conflicts.json`), the other side of that disagreement and its resolution note
are added regardless of score. Without this, "where does Jean work now?" can retrieve only the CV's
KPMG unit and answer confidently from one half of a conflict the model never saw.

Force-inclusion is capped at 5 extra units. Conflicts here span up to five units and a unit can be
party to several, so an uncapped cascade doubled the prompt on questions that needed one fact. The
cap is applied in rank order, so the best-matching units' conflicts win the budget. A conflict whose
partner units do not fit still contributes its resolution note — the disagreement is never silently
dropped, only its citable units.

## How prompting works, concretely

`lib/generation.ts`. One call to `client.messages.parse()` with `output_config.format` bound to a
Zod schema. No tools: retrieval already happened in TypeScript, so there is nothing for the model to
call, and modelling "answer the question" as a tool would add a layer with no behaviour in it.

The schema is the contract:

```ts
{ answerText: string,
  claims: [{ text: string, sourceIds: string[] /* min 1 */ }],
  hasSufficientContext: boolean }
```

`sourceIds` being non-empty means an uncited claim is not representable. That is a guarantee about
*shape* — the schema cannot know whether the cited unit actually supports the claim.

The system prompt states prohibitions with named failure modes rather than general encouragement:
Azure does not imply Kubernetes; building financial software does not imply a financial
qualification; "contributed to" is not "led"; absence of evidence is not evidence of absence. It
also states that the question is data and that an assertion by the asker is not a source. Each of
those clauses has an eval case aimed at it.

No `thinking` or `effort` parameters are sent. They are configured differently across model
families, and the eval compares two models on identical inputs — per-model branching would mean the
comparison measured the branching too.

## How a fact traces back to its source

Each claim carries the ids of the units supporting it. `lib/guard.ts` then checks every id against
the set supplied for that question. The UI renders each claim with its sources expanded beneath it,
including the full unit text, so a reader can verify the claim against the evidence without leaving
the page. The retrieved-but-uncited units are listed too — hiding them would conceal the cases where
retrieval found the right unit and the model ignored it.

One asymmetry between what the model sees and what the reader sees: the prompt receives **every**
conflict that force-inclusion triggered, because the model should reason with all of them. The UI
shows only those whose units were actually cited. Asking "where does Jean work now?" triggers three
conflicts, and displaying all three made one answer look like it had three unresolved problems.
Filtering the display does not weaken the disclosure — if the model ignored a conflict that bore on
its answer, the answer is wrong in a way the evaluation catches.

**When a fact cannot be traced, the answer is discarded.** A citation to an id that was not supplied
— invented, misremembered, or a real unit that was not retrieved — fails the whole response closed
to a deterministic fallback. So does an answer that asserts sufficiency while citing nothing. The
guard runs *before* the model's own `hasSufficientContext` flag, because a model that fabricated a
citation has already shown its self-report is not worth trusting on this turn.

### What the guard does not catch

Citing a unit that genuinely was supplied, while overstating what it says. "Built tax-calculation
software" becoming "is a certified financial adviser" cites a real, retrieved unit and passes every
mechanical check in this codebase.

Nothing here catches that. It is covered by must-not-claim labels graded by hand in the eval
(case E3 exists precisely for it) and reported as a measured rate, not a guarantee. Stating this
plainly is part of the design: a reviewer who believes the guard is total would trust the system
further than it deserves.

## Model choice, and what would change it

Default **`claude-sonnet-5`** ($2 / $10 per MTok). The task is narrow — grounded extraction and
synthesis over a handful of short units, with strict instruction-following on refusal and citation
discipline. That does not need frontier reasoning, and Opus-tier cost is not justified by anything
measured.

Concrete switch triggers, rather than a vague promise to revisit:

- **To `claude-opus-5`** if failures concentrate in the multi-source category — combining two units
  that are never adjacent is the one place where weaker synthesis would plausibly show up.
- **To `claude-haiku-4-5`** if it matches Sonnet on the unanswerable and adversarial categories,
  which are the ones that matter most, and p95 latency or cost become constraints.

The eval runs against both so this is decided by numbers. See `docs/evaluation.md`.

## Failure paths

| What happens | What the user sees | Why |
| --- | --- | --- |
| API timeout, 429, 5xx | Deterministic message saying the model is unreachable, plus the retrieved sources verbatim | A failure should still leave the user with sourced material they can read |
| Response fails schema validation (`parsed_output === null`) | Same as above | An answer with no claims is indistinguishable from a well-formed refusal and would be scored as one |
| Model cites an id it was not given | Answer discarded, guard message, sources listed | An unverifiable claim about someone's career is worse than no claim |
| Model reports insufficient context | Its own explanation, plus a template stating the knowledge base's limits | The model can say *what* was missing better than a template can |
| Retrieval returns nothing | Template refusal, no model call at all | Saves a call and makes the refusal certain rather than likely |
| `ANTHROPIC_API_KEY` unset | Loud error, not a user-facing refusal | A configuration fault must not masquerade as "no such fact" |
| Database unreachable or not migrated | Loud error naming `pnpm db:setup` when tables are missing; nothing is cached, so the next request retries | Same reason: an outage must never read as an empty record |

Every refusal string is a template, never model output. A generated refusal can invent its own
reason — explaining a fact "isn't in Jean's background" when the cause was a timeout. Since a
refusal is read as evidence of absence, the one thing it must never do is guess at why.

The SDK's default two retries on 429/5xx are left in place, because a transient blip surfacing as a
refusal would read as a fact about Jean rather than a fact about the network.

## Security and privacy

- **Secrets.** `ANTHROPIC_API_KEY` is read server-side only, in a route handler. It is never
  `NEXT_PUBLIC_*`, never reaches the browser bundle. `.env.local` is gitignored; `.env.example` names
  every variable and contains no values. Production values are set as Vercel environment variables.
- **What leaves the machine.** Per question: the system prompt, the retrieved units (typically 5–10
  short paragraphs), and the question. Never the whole corpus, and never anything not already in the
  committed knowledge base.
- **What the provider may retain.** Anthropic's API terms govern this, and the current terms should
  be checked rather than taken from this document. The relevant design property is that the data
  sent is already public — a CV Jean circulates, a public LinkedIn profile, and public GitHub
  metadata — so provider retention is a low-consequence question here. That would not be true if
  this pattern were pointed at customer records, which is the case the brief is really asking about.
- **PII.** Phone number and personal email are absent from the knowledge base entirely, removed at
  transcription time rather than filtered at runtime. There is nothing to leak. Asserted by test.
- **Exposure.** The deployment sits behind Vercel Deployment Protection, so the endpoint is not an
  open, credit-burning prompt-injection target. Input is capped at 2000 characters.

## Measured cost and latency

Real numbers from the committed 24-case runs in `eval/results/`, computed from the token counts the
API actually reported.

| | Sonnet 5 | Haiku 4.5 |
| --- | --- | --- |
| Cost per question | **$0.01529** | **$0.00403** |
| Full 24-case run | $0.3671 | $0.0967 |
| Latency p50 | **7,796 ms** | **2,562 ms** |
| Latency p95 | **17,532 ms** | **5,460 ms** |

Sonnet's p95 is dominated by long-answer cases: the slowest was a broad "is he senior enough to lead
a team?" question that retrieved ten units and wrote a long, hedged answer. Latency here tracks
output length far more than retrieval, which costs under a millisecond on a 43-unit index.

Both are single runs of 24 cases. That is a small sample and the numbers move between runs — see the
noise discussion in `docs/evaluation.md` before treating any of them as precise.

### What this says about the model choice

The evidence favours Haiku: it matched Sonnet on refusal correctness, retrieval recall and conflict
surfacing, while being roughly 3× faster and 3.8× cheaper. The default has deliberately **not** been
switched yet, because answer correctness was hand-graded on Sonnet only. Full reasoning in
`docs/evaluation.md`.

## Before production, and what breaks at 100×

**Before production:**

1. **Rate limiting and per-IP budget caps.** Deployment Protection is access control, not a spend
   limit. An authenticated user can still run up a bill.
2. **Prompt caching on the system prompt.** It is a fixed ~700 tokens on every call and is the
   single cheapest cost win available.
3. **Structured logging of question, retrieved ids, status and guard outcome.** Right now a
   guard rejection is invisible after the response is returned, and guard rejections are precisely
   the events worth alerting on.
4. **An ingestion schedule with staleness alerts.** `retrievedAt` is recorded but nothing acts on
   it. The headline conflict in this system is a stale LinkedIn record — the same failure would
   recur silently as the CV ages.

**What breaks first at 100×:** the Anthropic rate limit, well before anything in this codebase.
Retrieval is in-process over 43 units and is not the bottleneck at any traffic level this would
plausibly see; the index is rebuilt once per cold start.

The second thing to break would be cost, not latency — every question is a full-price call with no
caching, and identical questions are common in this domain ("what did you do at X?"). A response
cache keyed on the normalised question plus the knowledge base version would remove most of it.

The thing that would *not* break is correctness: the guard is pure in-process computation with no
shared state, so it behaves identically under load.

# How this was built

`ai-interactive-resume` started as a take-home exercise for a lead engineer role: build an assistant
that answers interview questions about one person, Jean Loureiro, without inventing anything. "The
brief" below and elsewhere in these docs refers to that exercise. Everything after it, from making
the subject configurable to hybrid retrieval, memory and invite-only access, was built in phases on
top, each with its eval cases committed before its code. `docs/evaluation.md` holds every phase's
cases, bars and results.

This page keeps the original write-up as it was, with one update noted where the facts changed.

## The original assistant

A source-grounded assistant that answers interview questions about Jean Loureiro's professional
background — and says so, explicitly, when it cannot ground an answer in a citable source.

Originally built as a take-home exercise for a lead engineer role. "The brief" in these docs refers
to that exercise.

> **The constraint that drives every decision here.** The assistant must never invent
> qualifications, employers, projects or achievements. The brief is explicit that a system
> fabricating an employer is the same failure class as one fabricating a balance. Where this system
> holds that line mechanically, it says so. Where it holds it only by measurement, it says that too —
> see [the guard's blind spot](../README.md#what-the-guard-does-not-catch).

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
in [docs/knowledge-layer.md](knowledge-layer.md).

**Update, 2026-10-08.** Jean's LinkedIn profile now lists KPMG as a past organisation and shows no
current employer, so the headline stale-employer conflict was resolved at the source. The ingest
caught it: it refused to run while `data/conflicts.json` still pointed at a LinkedIn unit that no
longer existed, and the conflict was retired. The other conflicts remain.

## The original evaluation (24 cases, BM25, Sonnet 5)

24 cases across all five required categories, with metrics and pass bars **committed before the
first run** — the commit history is the evidence.

Method, metric definitions, why there is no LLM-as-judge, and what would change if this guarded
money movement instead of a CV: **[docs/evaluation.md](evaluation.md)**.

### Results at the time

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

Three findings worth the click through to [docs/evaluation.md](evaluation.md):

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

## Decisions, cuts and AI use

Five decisions with what was rejected and what settled each, what was cut and why, where AI was used
and what was changed after review, and a self-review:
**[docs/decisions.md](decisions.md)**.

Short version on AI use: this repository was built by Claude Code (Opus 5) from a written plan, with
Jean directing and reviewing. The commit history is the real record — each message states the
reasoning for that step. `docs/decisions.md` lists what did not survive review, including one
factual error that reached a written plan before it was checked.

# Decisions, cuts and AI use

## Decision record

Five decisions, each with what was rejected and what settled it.

### 1. A deterministic pipeline, not an agent

**Rejected:** a tool-using agent that searches the knowledge base itself.

**Decided by:** the shape of the corpus. 43 short units, flat, no hierarchy to explore. An agent
loop would spend extra turns, tokens and latency rediscovering what one BM25 pass returns
immediately, and would add loop and partial-turn failure modes for no retrieval gain. Agents earn
their cost when the search space is large or the path is unknown; neither holds here.

**My Opnion:** I agree with this decision. The corpus is small and flat, so a simple retrieval system is more than enough. I considered using an agent, but for this case it is overkill.

### 2. Retrieval, even though the whole corpus fits in one prompt

**Rejected:** stuffing every unit into every prompt and skipping retrieval entirely.

**Decided by:** what it does to the guard. With stuffing, the strongest check available is "the
cited id exists somewhere in the knowledge base", which almost any plausible id passes. With
retrieval, the check becomes "the cited id was in the set supplied *for this question*" — something
a model cannot satisfy by guessing. The secondary reason is that stuffing stops being free the
moment a fourth source lands, and the fix would then be a retrieval layer introduced when the system
is largest.

This is the decision most worth arguing with, because the honest justification is *not* the usual
one. "The corpus is too big for context" would be false here and a reviewer doing the arithmetic
would catch it.

**My Opnion:** I think this is a good decision. The corpus is small and flat, so a simple retrieval system is more than enough. Also, it reduces the cost of the system and prepare for more sources to be added in. 

### 3. Redaction at transcription time, not at runtime

**Rejected:** ingesting the CV as-is and filtering contact details on the way out.

**Decided by:** the difference between a control that can fail and one that cannot. The phone number
and personal email are absent from `knowledge/sources/cv.md`, so they cannot reach the index, the
prompt, or a response — there is nothing to filter. A runtime filter is code that can be bypassed,
reordered, or forgotten. The cost is that re-transcription is manual; the benefit is that the
failure mode does not exist. Asserted by test against both the source file and the built index.

**My Opnion:** I think this is a good decision. It reduces the risk of exposing sensitive information and makes the system more secure.

### 4. Hand-graded correctness, no LLM judge

**Rejected:** an LLM-as-judge scoring groundedness automatically.

**Decided by:** the arithmetic of the time box and the brief's own requirement. The brief requires
any judge to be spot-checked against hand labels with agreement reported — so at 24 cases the
hand-grading happens either way, and the judge is pure addition. It would also add an unvalidated
second model whose prompt could be tuned until the scores looked right, which is precisely the
"eval written after the results" failure the brief calls out. The judge reappears in
`docs/evaluation.md` as the first thing to add if this guarded money movement, with these 24 labels
as its calibration seed.

**My Opnion:** I don't have a strong opinion on this one, but I think it's a good decision to discard the answer rather than show it with a warning.

### 5. Answer discarded on a bad citation, rather than shown with a warning

**Rejected:** displaying the answer with the unverifiable citation flagged.

**Decided by:** what a reader does with a warning. An answer about someone's career, shown with a
caveat, still gets read, quoted and believed — the caveat is the first thing dropped when the text
is copied into an email. The guard therefore fails closed: the answer is discarded, the user is told
why, and the retrieved sources are shown so they can read the evidence themselves. Losing a
probably-fine answer is cheaper than circulating an unverifiable claim.

**My opnion:** as the system needs to be contained to only give correct answers, this is a good decision. discard what is not 100% accurate.

## What was cut, and why it was right

- **PDF parsing.** The CV is transcribed by hand. Writing a parser for a three-page résumé is not
  what a time box is for, and transcription is what made redaction structural rather than a runtime
  filter — so the cut improved the design rather than merely saving time.
- **LLM-as-judge.** Argued above.
- **Consistency across rewordings.** The cheapest metric to cut for a CV: an inconsistent answer
  about a job title is untidy. For money movement it is central, so it is named as a gap rather than
  quietly dropped.
- **Multi-turn conversation.** The brief marks it optional. Every question is answered from a clean
  retrieval, which also means every answer is independently verifiable — carrying context would make
  it ambiguous which turn a citation belonged to.
- **Retrieval tuning.** Deliberately left alone. A known weakness — "can I see your code on GitHub?"
  does not rank the scope unit into the top 5 — was left in and measured rather than fixed by
  adjusting weights before the eval existed. Tuning a retriever against questions you have already
  written is how an eval ends up describing the system instead of testing it.

### The next three things

1. **Prompt caching on the system prompt**, a fixed ~700 tokens on every call — the single cheapest
   cost win available, and the one that matters first at scale.
2. **Structured logging of guard rejections, refusal rate and p95**, then alerting on them. A guard
   rejection is currently invisible the moment the response is returned, and it is the single most
   interesting event this system produces.
3. **Scheduled ingestion with staleness alerts on `retrievedAt`.** The headline conflict here is a
   stale LinkedIn record; the same failure will recur silently as the CV ages.

## Where AI was used, and where it was not

This repository was built by Claude Code (Opus 5) working from a written plan, with Jean directing,
reviewing and correcting. Being specific about that is the point — the brief says using AI heavily
is expected and not being able to account for it is the problem.

**Model-generated, then reviewed:** effectively all the implementation code, the test suite, the
eval dataset, and the prose in `docs/`. The commit history is the real record — each commit message
states the reasoning behind that step, and the commits are small enough to read individually.

**Changed after review:** several things did not survive first contact.

- The first retrieval implementation let conflict force-inclusion cascade without a bound; one
  probe pulled 11 units for a question with four good hits. Capped at five, applied in rank order.
- A missing API key was originally folded into the provider-unavailable path, which would have shown
  a user "try again in a moment" while an operator debugged a network problem that did not exist.
- The CV profile unit carried markdown bold into the corpus, so the model read
  `**Title:** Senior AI Engineer`. Caught by a test, not by review.
- The public GitHub profile was initially recorded as holding one repository. It holds 15. The
  first reading came from a mis-scoped `gh repo list` and was corrected against the API — an
  assumption that reached a written plan before it was checked.

## Self-review

Two changes I would ask for if this arrived as someone else's pull request.

**1. The guard's blind spot deserves a mechanical control, not just a measured rate.** Content-level
fabrication — citing a real unit while overstating it — is currently caught only by hand-grading 24
cases. A cheap improvement exists and was not built: a second, narrow model call that receives only
the claim text and the cited unit text and answers whether the unit supports the claim. That is a
bounded, testable check, unlike the general-purpose judge I argued against. I would want it before
trusting this pattern anywhere the cost of a wrong claim is real.

**2. `mustNotClaim` as substring matching is weaker than it looks.** It catches a model that
fabricates in the obvious phrasing and misses one that fabricates in a paraphrase — "holds a
doctorate" would sail past a rule watching for "PhD". The affirmative-phrasing convention reduces
false positives but does nothing for false negatives, and a reader could mistake a clean
must-not-claim column for stronger evidence than it is. At this size the hand-grading is the real
control; the automated check should be described as a tripwire, not a test.

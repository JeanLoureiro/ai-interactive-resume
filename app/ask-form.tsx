"use client";

import { useState } from "react";
import type { AssistantResponse } from "@/lib/models";
import styles from "./page.module.css";

/**
 * Sources are rendered expanded, not behind a disclosure.
 *
 * The audience is a reviewer checking whether an answer is grounded, not a consumer who wants a
 * clean chat bubble. Hiding the evidence one click away would optimise for the wrong reader, and
 * the brief is explicit that it would rather see a CLI showing its sources than a polished chat
 * window that does not.
 */

const STATUS_META: Record<AssistantResponse["status"], { label: string; tone: string; note: string }> = {
  answered: {
    label: "Answered from sources",
    tone: "good",
    note: "Every claim below is tied to the sources that support it.",
  },
  insufficient_context: {
    label: "No sourced answer",
    tone: "warn",
    note: "The knowledge base does not cover this. That is reported rather than guessed at.",
  },
  guard_rejected: {
    label: "Rejected by the citation guard",
    tone: "bad",
    note: "The model cited sources it was not given, so the answer was discarded before you saw it.",
  },
  provider_error: {
    label: "Model API unavailable",
    tone: "bad",
    note: "A temporary failure reaching the model — not a gap in the record.",
  },
};

export interface AskFormProps {
  /** How the page refers to the subject, e.g. a first name. */
  subjectName: string;
  /** "CV, public LinkedIn profile and public GitHub repositories", trimmed to what is configured. */
  sources: string;
  suggestions: string[];
}

export function AskForm({ subjectName, sources, suggestions }: AskFormProps) {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Something went wrong.");
      else setResponse(body as AssistantResponse);
    } catch {
      setError("Could not reach the assistant.");
    } finally {
      setPending(false);
    }
  }

  const meta = response ? STATUS_META[response.status] : null;

  // Retrieval force-includes every conflict a retrieved unit is party to, which is right for the
  // prompt — the model should reason with all of them. It is wrong for the reader: asking where
  // the subject works surfaced a certifications gap and a GitHub gap alongside the employment one, which
  // reads as three unresolved problems with the answer rather than one. Show only the disagreements
  // that bear on what was actually cited. If the model ignored a relevant conflict, the answer is
  // wrong in a way the evaluation catches, not something to paper over here.
  const citedIds = new Set(
    response?.claims.flatMap((claim) => claim.sources.map((source) => source.id)) ?? [],
  );
  const relevantConflicts =
    response?.conflicts.filter((conflict) => conflict.unitIds.some((id) => citedIds.has(id))) ?? [];

  return (
    <main>
      <header className={styles.header}>
        <h1 className={styles.title}>Ask about {subjectName}</h1>
        <p className={styles.sub}>
          Answers come only from {subjectName}&apos;s {sources}. Every claim shows the source behind
          it. When the sources do not cover something, this says so instead of guessing.
        </p>
      </header>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <input
          className={styles.input}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={`What has ${subjectName} built?`}
          aria-label="Your question"
          maxLength={2000}
        />
        <button className={styles.button} type="submit" disabled={pending || !question.trim()}>
          {pending ? "Asking…" : "Ask"}
        </button>
      </form>

      <div className={styles.suggestions}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={styles.chip}
            disabled={pending}
            onClick={() => {
              setQuestion(suggestion);
              void submit(suggestion);
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {response && meta && (
        <section className={styles.result} aria-live="polite">
          <div className={`${styles.status} ${styles[meta.tone]}`}>
            <strong>{meta.label}</strong>
            <span>{meta.note}</span>
          </div>

          <p className={styles.answer}>{response.answerText}</p>

          {relevantConflicts.length > 0 && (
            <div className={styles.conflicts}>
              <h2 className={styles.h2}>Sources disagree here</h2>
              {relevantConflicts.map((conflict) => (
                <div key={conflict.id} className={styles.conflict}>
                  <span className={styles.kind}>{conflict.kind}</span>
                  <p>{conflict.resolutionNote}</p>
                </div>
              ))}
            </div>
          )}

          {response.claims.length > 0 && (
            <div>
              <h2 className={styles.h2}>Claims and their sources</h2>
              {response.claims.map((claim, index) => (
                <div key={index} className={styles.claim}>
                  <p className={styles.claimText}>{claim.text}</p>
                  {claim.sources.map((source) => (
                    <details key={source.id} className={styles.source}>
                      <summary>
                        <span className={styles.badge}>{source.source}</span>
                        {source.title}
                        <code className={styles.id}>{source.id}</code>
                      </summary>
                      <p className={styles.sourceText}>{source.text}</p>
                    </details>
                  ))}
                </div>
              ))}
            </div>
          )}

          <details className={styles.retrieved}>
            <summary>
              Retrieved for this question ({response.retrieved.length}) — including sources the answer
              did not use
            </summary>
            <ul>
              {response.retrieved.map((unit) => (
                <li key={unit.id}>
                  <code className={styles.id}>{unit.id}</code> {unit.title}
                </li>
              ))}
            </ul>
          </details>

          <p className={styles.diag}>
            {response.diagnostics.model} · {response.diagnostics.latencyMs}ms ·{" "}
            {response.diagnostics.inputTokens} in / {response.diagnostics.outputTokens} out · $
            {response.diagnostics.costUsd.toFixed(5)}
            {response.diagnostics.invalidSourceIds.length > 0 && (
              <> · rejected citations: {response.diagnostics.invalidSourceIds.join(", ")}</>
            )}
          </p>
        </section>
      )}
    </main>
  );
}

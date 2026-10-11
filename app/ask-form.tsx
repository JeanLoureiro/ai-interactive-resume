"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AssistantResponse } from "@/lib/models";
import styles from "./page.module.css";

/**
 * The answer is the default view. Disagreements, claims, retrieved units, and diagnostics sit
 * behind a checkbox that starts off, so a visitor can read the reply without the evidence trail.
 * Turning it on renders sources expanded: a reviewer checking whether an answer is grounded should
 * not have to open each passage individually.
 */

const TECHNICAL_STORAGE_KEY = "show-technical-details";

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

/** One answer: status and text, plus the evidence trail when the visitor has asked to see it. */
function ResponseView({ response, showTechnical }: { response: AssistantResponse; showTechnical: boolean }) {
  const meta = STATUS_META[response.status];

  // Retrieval force-includes every conflict a retrieved unit is party to, which is right for the
  // prompt — the model should reason with all of them. It is wrong for the reader: asking where
  // the subject works surfaced a certifications gap and a GitHub gap alongside the employment one, which
  // reads as three unresolved problems with the answer rather than one. Show only the disagreements
  // that bear on what was actually cited. If the model ignored a relevant conflict, the answer is
  // wrong in a way the evaluation catches, not something to paper over here.
  const citedIds = new Set(response.claims.flatMap((claim) => claim.sources.map((source) => source.id)));
  const relevantConflicts = response.conflicts.filter((conflict) => conflict.unitIds.some((id) => citedIds.has(id)));

  return (
    <section className={styles.result} aria-live="polite">
      <div className={`${styles.status} ${styles[meta.tone]}`}>
        <strong>{meta.label}</strong>
        <span>{meta.note}</span>
      </div>

      <p className={styles.answer}>{response.answerText}</p>

      {showTechnical && relevantConflicts.length > 0 && (
        <div className={styles.conflicts}>
          <h2 className={styles.h2}>Sources disagree here</h2>
          {relevantConflicts.map((conflict) => (
            <div key={conflict.id} className={styles.conflict}>
              <span className={styles.kind}>{conflict.kind}</span>
              <p>{conflict.summary}</p>
            </div>
          ))}
        </div>
      )}

      {showTechnical && response.claims.length > 0 && (
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

      {showTechnical && (
        <>
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
        </>
      )}
    </section>
  );
}

interface Turn {
  question: string;
  response: AssistantResponse;
}

interface Status {
  mode: "invite" | "public";
  access: boolean;
  /** False on a fresh deployment whose database has no resume yet. */
  ready: boolean;
  requestAccessUrl: string | null;
}

/** Shown instead of the chat when the site is invite-only and this browser has no valid invite. */
function Gate({
  subjectName,
  requestAccessUrl,
  onAccess,
}: {
  subjectName: string;
  requestAccessUrl: string | null;
  onAccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function redeem() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    setPending(false);
    if (res?.ok) return onAccess();
    setError((await res?.json().catch(() => null))?.error ?? "Could not reach the assistant.");
  }

  return (
    <section className={styles.gate}>
      <p>
        This assistant answers questions about {subjectName}&apos;s background by invitation. Enter
        the code you were sent.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void redeem();
        }}
      >
        <input
          className={styles.input}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="e.g. K7Q2-9XMP"
          aria-label="Invite code"
          autoComplete="one-time-code"
          maxLength={32}
        />
        <button className={styles.button} type="submit" disabled={pending || code.trim().length < 4}>
          {pending ? "Checking…" : "Continue"}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      {requestAccessUrl && (
        <p className={styles.notice}>
          No code?{" "}
          <a className={styles.link} href={requestAccessUrl} target="_blank" rel="noreferrer">
            Request access from {subjectName} on LinkedIn
          </a>
          .
        </p>
      )}
    </section>
  );
}

export function AskForm({ subjectName, sources, suggestions: defaultSuggestions }: AskFormProps) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState<{ enabled: boolean; retentionDays?: number }>({ enabled: false });
  const [suggestions, setSuggestions] = useState(defaultSuggestions);
  const [status, setStatus] = useState<Status | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const technicalNoteId = useId();
  const endRef = useRef<HTMLDivElement>(null);

  // Unchecked on a first visit. A later choice is kept in this browser.
  useEffect(() => {
    try {
      if (localStorage.getItem(TECHNICAL_STORAGE_KEY) === "1") setShowTechnical(true);
    } catch {
      // Private browsing can reject storage. The checkbox still works for this visit.
    }
  }, []);

  function setTechnicalVisible(visible: boolean) {
    setShowTechnical(visible);
    try {
      localStorage.setItem(TECHNICAL_STORAGE_KEY, visible ? "1" : "0");
    } catch {
      // Same as above: the choice applies for this visit even if it cannot be stored.
    }
  }

  // The page is prerendered, so who this visitor is (invited, owner, nobody) is decided here. An
  // invite link carries ?code=; it is redeemed once and removed from the address bar, so it does not
  // linger in history or screenshots.
  async function loadStatus() {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      window.history.replaceState(null, "", window.location.pathname);
      await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }).catch(() => undefined);
    }
    const res = await fetch("/api/status").catch(() => null);
    setStatus(
      res?.ok
        ? ((await res.json()) as Status)
        : { mode: "public", access: true, ready: true, requestAccessUrl: null },
    );
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  // The visitor's thread and the approved suggestions, once they have access. Both fail quietly:
  // without them the page still works as a single-question assistant.
  useEffect(() => {
    if (!status?.access || !status.ready) return;
    void fetch("/api/conversation")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { memory: boolean; retentionDays?: number; turns: Turn[] } | null) => {
        if (!body) return;
        setMemory({ enabled: body.memory, ...(body.retentionDays ? { retentionDays: body.retentionDays } : {}) });
        setTurns(body.turns);
      })
      .catch(() => undefined);
    void fetch("/api/suggestions")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { suggestions: string[] } | null) => {
        if (body?.suggestions.length) setSuggestions(body.suggestions);
      })
      .catch(() => undefined);
  }, [status?.access, status?.ready]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, asking]);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed || asking) return;
    setAsking(trimmed);
    setError(null);
    setQuestion("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await res.json();
      if (res.status === 401 && body.gate) {
        // The invite expired or was revoked while the page was open.
        setStatus((current) => (current ? { ...current, access: false } : current));
        setQuestion(trimmed);
      } else if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        setQuestion(trimmed);
      } else {
        // Without a database there is no memory, so the page shows one answer at a time, as it is.
        const turn = { question: trimmed, response: body as AssistantResponse };
        setTurns((current) => (memory.enabled ? [...current, turn] : [turn]));
      }
    } catch {
      setError("Could not reach the assistant.");
      setQuestion(trimmed);
    } finally {
      setAsking(null);
    }
  }

  async function newConversation() {
    await fetch("/api/conversation", { method: "DELETE" }).catch(() => undefined);
    setTurns([]);
    setError(null);
  }

  return (
    <main>
      <header className={styles.header}>
        <h1 className={styles.title}>Ask about {subjectName}</h1>
        <p className={styles.sub}>
          Answers come only from {subjectName}&apos;s {sources}. Every claim shows the source behind
          it. When the sources do not cover something, this says so instead of guessing.
        </p>
      </header>

      {!status && <p className={styles.notice}>Loading…</p>}

      {status && !status.ready && (
        <section className={styles.gate}>
          <p>
            No resume has been added yet. If this is your deployment, sign in at{" "}
            <a className={styles.link} href="/admin">
              /admin
            </a>{" "}
            and upload one.
          </p>
        </section>
      )}

      {status?.ready && !status.access && (
        <Gate
          subjectName={subjectName}
          requestAccessUrl={status.requestAccessUrl}
          onAccess={() => void loadStatus()}
        />
      )}

      {status?.ready && status.access && (
        <>
          <div className={styles.technicalToggle}>
            <label className={styles.technicalLabel}>
              <input
                type="checkbox"
                checked={showTechnical}
                aria-describedby={technicalNoteId}
                onChange={(event) => setTechnicalVisible(event.target.checked)}
              />
              Show technical details
            </label>
            <p className={styles.technicalNote} id={technicalNoteId}>
              Where sources disagree, each claim with the passage behind it, sources retrieved for
              the question (including ones the answer did not use), and model diagnostics.
            </p>
          </div>

          {turns.length === 0 && (
            <div className={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={styles.chip}
                  disabled={asking !== null}
                  onClick={() => void submit(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <div className={styles.thread} aria-live="polite">
            {turns.map((turn, index) => (
              <div key={index} className={styles.turn}>
                <p className={styles.question}>{turn.question}</p>
                <ResponseView response={turn.response} showTechnical={showTechnical} />
              </div>
            ))}
            {asking && (
              <div className={styles.turn}>
                <p className={styles.question}>{asking}</p>
                <p className={styles.thinking}>Finding sources and checking every claim…</p>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {error && <p className={styles.error}>{error}</p>}

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
              placeholder={turns.length > 0 && memory.enabled ? "Ask a follow-up…" : `What has ${subjectName} built?`}
              aria-label="Your question"
              maxLength={2000}
            />
            <button className={styles.button} type="submit" disabled={asking !== null || !question.trim()}>
              {asking ? "Asking…" : "Ask"}
            </button>
          </form>

          <p className={styles.notice}>
            {memory.enabled
              ? `Questions are stored for up to ${memory.retentionDays ?? 90} days to improve this assistant.`
              : "Each question is answered on its own."}
            {memory.enabled && turns.length > 0 && (
              <>
                {" "}
                <button type="button" className={styles.linkButton} onClick={() => void newConversation()}>
                  New conversation
                </button>
              </>
            )}
          </p>
        </>
      )}
    </main>
  );
}

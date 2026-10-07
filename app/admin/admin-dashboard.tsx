"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UnitDiff } from "@/lib/admin/drafts";
import type { KnowledgeUnit } from "@/lib/models";
import type { ResumeReport } from "@/lib/resume";
import styles from "./admin.module.css";

export interface DraftSummary {
  fileName: string;
  createdAt: string;
  report: ResumeReport;
  diff: UnitDiff;
}

async function post(path: string, body?: BodyInit): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(path, { method: "POST", body }).catch(() => null);
  if (!response) return { ok: false, error: "Could not reach the server." };
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: response.ok, ...(json.error ? { error: json.error } : {}) };
}

function UnitList({ title, units }: { title: string; units: KnowledgeUnit[] }) {
  if (units.length === 0) return null;
  return (
    <div>
      <h3 className={styles.h3}>
        {title} ({units.length})
      </h3>
      {units.map((unit) => (
        <details key={unit.id} className={styles.unit}>
          <summary>
            <code>{unit.id}</code> {unit.title}
            {unit.dateStart && <span className={styles.muted}> · {unit.dateStart} to {unit.dateEnd ?? "present"}</span>}
          </summary>
          <p className={styles.unitText}>{unit.text}</p>
        </details>
      ))}
    </div>
  );
}

export function AdminDashboard({ liveCvCount, draft }: { liveCvCount: number; draft: DraftSummary | undefined }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"upload" | "publish" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: "upload" | "publish" | "discard", path: string, body?: BodyInit, success?: string) {
    setBusy(action);
    setError(null);
    setNotice(null);
    const result = await post(path, body);
    setBusy(null);
    if (!result.ok) return setError(result.error ?? "Something went wrong.");
    if (success) setNotice(success);
    router.refresh();
  }

  const report = draft?.report;
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin</h1>
        <button className={styles.ghost} onClick={() => void run("discard", "/api/admin/logout")} type="button">
          Sign out
        </button>
      </div>
      <p className={styles.muted}>The live knowledge base has {liveCvCount} resume units.</p>

      <section className={styles.card}>
        <h2 className={styles.h2}>Upload a resume</h2>
        <p className={styles.muted}>
          PDF, DOCX or Markdown, up to 4MB. The file is read in memory and discarded: only the checked units are
          kept, and nothing goes live until you publish.
        </p>
        <form
          className={styles.row}
          onSubmit={(event) => {
            event.preventDefault();
            if (!file) return;
            const form = new FormData();
            form.set("resume", file);
            void run("upload", "/api/admin/resume", form);
          }}
        >
          <input
            className={styles.input}
            type="file"
            accept=".pdf,.docx,.md"
            aria-label="Resume file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button className={styles.button} type="submit" disabled={!file || busy !== null}>
            {busy === "upload" ? "Reading…" : "Upload"}
          </button>
        </form>
        {busy === "upload" && (
          <p className={styles.notice} role="status">
            Reading and checking your resume. This usually takes under a minute.
          </p>
        )}
      </section>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.success}>{notice}</p>}

      {draft && report && (
        <section className={styles.card}>
          <h2 className={styles.h2}>Review before publishing</h2>
          <p className={styles.muted}>
            {draft.fileName} · uploaded {new Date(draft.createdAt).toLocaleString()} ·{" "}
            {report.path === "format-contract" ? "parsed from the Markdown format, no model" : `read by ${report.model}`}
          </p>
          <ul className={styles.stats}>
            <li>
              <strong>{draft.diff.added.length}</strong> new
            </li>
            <li>
              <strong>{draft.diff.changed.length}</strong> changed
            </li>
            <li>
              <strong>{draft.diff.removed.length}</strong> removed
            </li>
            <li>
              <strong>{draft.diff.unchanged}</strong> unchanged
            </li>
            <li>
              <strong>{report.removedContacts.emails + report.removedContacts.phones}</strong> contact details removed
            </li>
          </ul>

          {report.dropped.length > 0 && (
            <div className={styles.dropped}>
              <h3 className={styles.h3}>Dropped by the ingest guard ({report.dropped.length})</h3>
              <p className={styles.muted}>
                These could not be matched to your resume&apos;s text, so they will not be stored. If one is genuine,
                rephrase it in the resume and upload again.
              </p>
              <ul>
                {report.dropped.map((fragment, index) => (
                  <li key={index}>
                    <span className={styles.tag}>{fragment.field}</span> &ldquo;{fragment.text}&rdquo;{" "}
                    <span className={styles.muted}>
                      {fragment.missing.length
                        ? `not in your resume: ${fragment.missing.join(", ")}`
                        : `reads too differently (${fragment.similarity.toFixed(2)})`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <UnitList title="New" units={draft.diff.added} />
          <UnitList title="Changed (new version)" units={draft.diff.changed.map(({ after }) => after)} />
          <UnitList title="Removed" units={draft.diff.removed} />

          <div className={styles.row}>
            <button
              className={styles.button}
              type="button"
              disabled={busy !== null}
              onClick={() => void run("publish", "/api/admin/publish", undefined, "Published. Answers use the new resume now on this server, and everywhere within 5 minutes.")}
            >
              {busy === "publish" ? "Publishing…" : "Publish"}
            </button>
            <button className={styles.ghost} type="button" disabled={busy !== null} onClick={() => void run("discard", "/api/admin/discard")}>
              Discard
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

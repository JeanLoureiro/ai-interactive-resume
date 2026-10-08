"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UnitDiff } from "@/lib/admin/drafts";
import type { KnowledgeUnit } from "@/lib/models";
import type { InviteSummary } from "@/lib/access";
import type { Suggestion } from "@/lib/memory";
import type { ResumeReport } from "@/lib/resume";
import styles from "./admin.module.css";

export interface DraftSummary {
  fileName: string;
  createdAt: string;
  report: ResumeReport;
  diff: UnitDiff;
}

async function post(path: string, body?: BodyInit): Promise<{ ok: boolean; error?: string }> {
  const headers = typeof body === "string" ? { "content-type": "application/json" } : undefined;
  const response = await fetch(path, { method: "POST", body, ...(headers ? { headers } : {}) }).catch(() => null);
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

const STATUS_LABEL: Record<InviteSummary["status"], string> = {
  unused: "not used yet",
  active: "active",
  expired: "expired",
  revoked: "revoked",
};

function InvitesSection({ invites, inviteOnly, onChange }: { invites: InviteSummary[]; inviteOnly: boolean; onChange: () => void }) {
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<{ code: string; link: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(body: object): Promise<{ code?: string; link?: string } | null> {
    setError(null);
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { code?: string; link?: string; error?: string };
    if (!res?.ok) {
      setError(json.error ?? "Something went wrong.");
      return null;
    }
    onChange();
    return json;
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>Invites</h2>
      <p className={styles.muted}>
        {inviteOnly
          ? "Only you and people with an invite can ask questions. An invite lasts 24 hours from first use, on any device; one never used expires after 14 days."
          : "ACCESS_MODE is public, so anyone can ask questions. Invites still work if you switch to invite mode."}
      </p>
      <form
        className={styles.row}
        onSubmit={(event) => {
          event.preventDefault();
          const forLabel = label.trim();
          void act({ action: "create", label: forLabel }).then((result) => {
            if (result?.code && result.link) setCreated({ code: result.code, link: result.link, label: forLabel });
          });
          setLabel("");
        }}
      >
        <input className={styles.input} aria-label="Invite label" placeholder="Who is it for? e.g. Acme recruiter" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={100} />
        <button className={styles.button} type="submit" disabled={!label.trim()}>
          Create invite
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      {created && (
        <div className={styles.success}>
          <p>
            Invite for <strong>{created.label}</strong>. Copy it now: the code is not stored and cannot be shown again.
          </p>
          <p>
            <code>{created.link}</code>{" "}
            <button type="button" className={styles.ghost} onClick={() => void navigator.clipboard.writeText(created.link)}>
              Copy link
            </button>
          </p>
          <p>
            Code: <code>{created.code}</code>{" "}
            <button type="button" className={styles.ghost} onClick={() => void navigator.clipboard.writeText(created.code)}>
              Copy code
            </button>
          </p>
        </div>
      )}
      {invites.map((invite) => (
        <div key={invite.id} className={styles.suggestion}>
          <span>
            {invite.label}{" "}
            <span className={styles.muted}>
              · {STATUS_LABEL[invite.status]}
              {invite.status === "active" && invite.expiresAt ? ` until ${new Date(invite.expiresAt).toLocaleString()}` : ""} · {invite.questionsAsked} question
              {invite.questionsAsked === 1 ? "" : "s"}
            </span>
          </span>
          {(invite.status === "active" || invite.status === "unused") && (
            <button className={styles.ghost} type="button" onClick={() => void act({ action: "revoke", id: invite.id })}>
              Revoke
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function SuggestionsSection({ suggestions, act }: { suggestions: Suggestion[]; act: (body: object) => void }) {
  const [text, setText] = useState("");
  const pending = suggestions.filter((suggestion) => !suggestion.approved);
  const shown = suggestions.filter((suggestion) => suggestion.approved);
  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>Suggested questions</h2>
      <p className={styles.muted}>
        Shown as chips under the question box, most asked first. Visitors&apos; questions appear here only when they
        were answered from sources, and are shown to others only after you approve them.
      </p>
      <form
        className={styles.row}
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) act({ action: "add", text });
          setText("");
        }}
      >
        <input className={styles.input} aria-label="New suggested question" placeholder="Add your own suggested question" value={text} onChange={(event) => setText(event.target.value)} maxLength={300} />
        <button className={styles.button} type="submit" disabled={!text.trim()}>
          Add
        </button>
      </form>
      <h3 className={styles.h3}>Waiting for approval ({pending.length})</h3>
      {pending.length === 0 && <p className={styles.muted}>Nothing waiting.</p>}
      {pending.map((suggestion) => (
        <div key={suggestion.id} className={styles.suggestion}>
          <span>
            {suggestion.text} <span className={styles.muted}>· asked {suggestion.timesAsked}×</span>
          </span>
          <span className={styles.row}>
            <button className={styles.ghost} type="button" onClick={() => act({ action: "approve", id: suggestion.id })}>Approve</button>
            <button className={styles.ghost} type="button" onClick={() => act({ action: "remove", id: suggestion.id })}>Remove</button>
          </span>
        </div>
      ))}
      <h3 className={styles.h3}>Shown to visitors ({shown.length})</h3>
      {shown.map((suggestion) => (
        <div key={suggestion.id} className={styles.suggestion}>
          <span>
            {suggestion.text} <span className={styles.muted}>· {suggestion.origin === "owner" ? "yours" : `asked ${suggestion.timesAsked}×`}</span>
          </span>
          <span className={styles.row}>
            {suggestion.origin === "visitor" && (
              <button className={styles.ghost} type="button" onClick={() => act({ action: "hide", id: suggestion.id })}>Hide</button>
            )}
            <button className={styles.ghost} type="button" onClick={() => act({ action: "remove", id: suggestion.id })}>Remove</button>
          </span>
        </div>
      ))}
    </section>
  );
}

export function AdminDashboard({
  liveCvCount,
  draft,
  suggestions,
  invites,
  inviteOnly,
}: {
  liveCvCount: number;
  draft: DraftSummary | undefined;
  suggestions: Suggestion[];
  invites: InviteSummary[];
  inviteOnly: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"upload" | "publish" | "discard" | "suggest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: "upload" | "publish" | "discard" | "suggest", path: string, body?: BodyInit, success?: string) {
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

      <InvitesSection invites={invites} inviteOnly={inviteOnly} onChange={() => router.refresh()} />

      <SuggestionsSection suggestions={suggestions} act={(body) => void run("suggest", "/api/admin/suggestions", JSON.stringify(body))} />

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

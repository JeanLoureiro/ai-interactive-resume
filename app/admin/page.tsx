import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isAdminEnabled, isValidSession, SESSION_COOKIE } from "@/lib/admin/auth";
import { diffCvUnits, getDraft } from "@/lib/admin/drafts";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { createPostgresKnowledgeStore } from "@/lib/db/knowledge-store";
import { buildKnowledgeBase } from "@/lib/knowledge";
import { listSuggestions } from "@/lib/memory";
import { getAccessMode, listInvites } from "@/lib/access";
import { AdminDashboard } from "./admin-dashboard";
import { AdminLogin } from "./admin-login";
import styles from "./admin.module.css";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // An unconfigured deployment does not advertise that /admin exists.
  if (!isAdminEnabled()) notFound();
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) return <AdminLogin />;

  if (!isDatabaseConfigured()) {
    return (
      <main className={styles.main}>
        <h1 className={styles.title}>Admin</h1>
        <p className={styles.notice}>
          Uploading a resume needs a database, because the server cannot write files on a hosted
          deployment. Set <code>DATABASE_URL</code>, run <code>pnpm db:setup</code>, and reload.
        </p>
      </main>
    );
  }

  const db = getDb();
  const [draft, live, suggestions, invites] = await Promise.all([
    getDraft(db),
    createPostgresKnowledgeStore(db).load().then(buildKnowledgeBase),
    listSuggestions(db, { approvedOnly: false }),
    listInvites(db),
  ]);
  const liveCv = live.units.filter((unit) => unit.source === "cv");

  return (
    <AdminDashboard
      liveCvCount={liveCv.length}
      suggestions={suggestions}
      invites={invites}
      inviteOnly={getAccessMode() === "invite"}
      draft={
        draft && {
          fileName: draft.fileName,
          createdAt: draft.createdAt.toISOString(),
          report: draft.report,
          diff: diffCvUnits(live.units, draft.units),
        }
      }
    />
  );
}

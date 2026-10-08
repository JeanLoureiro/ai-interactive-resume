import { resolveAccess } from "@/lib/access";
import { getRetentionDays } from "@/lib/config";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { loadThread } from "@/lib/memory";
import { clearedConversationCookie, readConversationId } from "@/lib/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The visitor's thread, so a reload shows it again. `memory: false` means no database, no history. */
export async function GET(request: Request): Promise<Response> {
  if (!isDatabaseConfigured()) return Response.json({ memory: false, turns: [] });
  if (!(await resolveAccess(request, getDb())).allowed) return Response.json({ error: "Invite required.", gate: true }, { status: 401 });
  const id = readConversationId(request);
  const turns = id ? await loadThread(getDb(), id) : [];
  return Response.json({ memory: true, retentionDays: getRetentionDays(), turns });
}

/** "New conversation": forget the id. Stored turns are deleted by the retention job like any other. */
export async function DELETE(): Promise<Response> {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedConversationCookie() } });
}

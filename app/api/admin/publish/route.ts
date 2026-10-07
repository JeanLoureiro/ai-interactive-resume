import { publishDraft } from "@/lib/admin/drafts";
import { guardAdminRequest } from "@/lib/admin/http";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { invalidateKnowledgeBase } from "@/lib/knowledge";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const refused = guardAdminRequest(request);
  if (refused) return refused;
  if (!isDatabaseConfigured()) return Response.json({ error: "Publishing needs a database." }, { status: 409 });
  try {
    const { units } = await publishDraft(getDb());
    invalidateKnowledgeBase();
    return Response.json({ ok: true, units });
  } catch (error) {
    // The usual cause is a known conflict pointing at a CV unit the new resume no longer has. The
    // message names the conflict and the unit, which is exactly what the owner needs to fix it.
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 409 });
  }
}

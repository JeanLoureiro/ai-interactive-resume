import { discardDraft } from "@/lib/admin/drafts";
import { guardAdminRequest } from "@/lib/admin/http";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const refused = guardAdminRequest(request);
  if (refused) return refused;
  if (isDatabaseConfigured()) await discardDraft(getDb());
  return Response.json({ ok: true });
}

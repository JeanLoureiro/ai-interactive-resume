import { resolveAccess } from "@/lib/access";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { listSuggestions } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Approved suggestions, most asked first. Empty means the page keeps its built-in defaults. */
export async function GET(request: Request): Promise<Response> {
  if (!isDatabaseConfigured()) return Response.json({ suggestions: [] });
  if (!(await resolveAccess(request, getDb())).allowed) return Response.json({ suggestions: [] });
  const approved = await listSuggestions(getDb(), { approvedOnly: true });
  return Response.json({ suggestions: approved.slice(0, 6).map((suggestion) => suggestion.text) });
}

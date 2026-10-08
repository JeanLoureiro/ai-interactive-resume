import { z } from "zod";
import { guardAdminRequest } from "@/lib/admin/http";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { addOwnerSuggestion, removeSuggestion, setSuggestionApproved } from "@/lib/memory";

export const runtime = "nodejs";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), text: z.string().trim().min(3).max(300) }),
  z.object({ action: z.enum(["approve", "hide", "remove"]), id: z.string().uuid() }),
]);

/** The owner curates suggested questions: add their own, approve or hide visitors', remove any. */
export async function POST(request: Request): Promise<Response> {
  const refused = guardAdminRequest(request);
  if (refused) return refused;
  if (!isDatabaseConfigured()) return Response.json({ error: "Suggestions need a database." }, { status: 409 });

  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid suggestion action." }, { status: 400 });

  const db = getDb();
  const input = parsed.data;
  if (input.action === "add") await addOwnerSuggestion(db, input.text);
  else if (input.action === "remove") await removeSuggestion(db, input.id);
  else await setSuggestionApproved(db, input.id, input.action === "approve");
  return Response.json({ ok: true });
}

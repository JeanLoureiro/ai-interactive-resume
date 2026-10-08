import { z } from "zod";
import { createInvite, revokeInvite } from "@/lib/access";
import { guardAdminRequest } from "@/lib/admin/http";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";

export const runtime = "nodejs";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid() }),
]);

/** Create an invite (the code is returned once and never stored) or revoke one. */
export async function POST(request: Request): Promise<Response> {
  const refused = guardAdminRequest(request);
  if (refused) return refused;
  if (!isDatabaseConfigured()) return Response.json({ error: "Invites need a database." }, { status: 409 });

  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the invite a label, e.g. the recruiter's company." }, { status: 400 });

  const db = getDb();
  if (parsed.data.action === "revoke") {
    await revokeInvite(db, parsed.data.id);
    return Response.json({ ok: true });
  }
  const { code } = await createInvite(db, parsed.data.label);
  const link = `${new URL(request.url).origin}/?code=${code}`;
  return Response.json({ ok: true, code, link });
}

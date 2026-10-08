import { getAccessMode, resolveAccess } from "@/lib/access";
import { getSubject } from "@/lib/config";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { getKnowledgeBase } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the page should show: the chat, the invite gate, or (on a fresh deployment with an empty
 * database) the setup message pointing the owner to /admin. Public; reveals nothing private.
 */
export async function GET(request: Request): Promise<Response> {
  const db = isDatabaseConfigured() ? getDb() : undefined;
  const [access, kb] = await Promise.all([resolveAccess(request, db), getKnowledgeBase()]);
  return Response.json({
    mode: getAccessMode(),
    access: access.allowed,
    ready: kb.units.some((unit) => unit.source === "cv"),
    requestAccessUrl: getSubject().linkedinProfile ?? null,
  });
}

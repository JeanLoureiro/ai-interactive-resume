import { clearedSessionCookie, guardAdminRequest } from "@/lib/admin/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const refused = guardAdminRequest(request, { requireSession: false });
  if (refused) return refused;
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie() } });
}

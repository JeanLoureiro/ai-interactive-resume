import { z } from "zod";
import { createSession, loginThrottle, passwordMatches } from "@/lib/admin/auth";
import { clientAddress, guardAdminRequest, sessionCookie } from "@/lib/admin/http";

export const runtime = "nodejs";

const LoginSchema = z.object({ password: z.string().max(1000) });

export async function POST(request: Request): Promise<Response> {
  const refused = guardAdminRequest(request, { requireSession: false });
  if (refused) return refused;

  const address = clientAddress(request);
  if (loginThrottle.isBlocked(address)) {
    return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }
  const parsed = LoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !passwordMatches(parsed.data.password)) {
    loginThrottle.recordFailure(address);
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(createSession()) } });
}

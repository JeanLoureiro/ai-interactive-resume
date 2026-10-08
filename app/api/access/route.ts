import { z } from "zod";
import { ACCESS_COOKIE, accessCookieValue, redeemInvite } from "@/lib/access";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { clientAddress, setCookie } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const RedeemSchema = z.object({ code: z.string().trim().min(4).max(32) });
/** Code attempts per address per hour: enough for typos, too few to guess 8 characters. */
const REDEEM_ATTEMPTS_PER_HOUR = 10;

/** Exchanges an invite code (typed, or from a link) for a signed cookie valid until the invite expires. */
export async function POST(request: Request): Promise<Response> {
  if (!isDatabaseConfigured()) return Response.json({ error: "Invites are not enabled here." }, { status: 404 });
  const db = getDb();

  const limit = await consumeRateLimit(db, `redeem|${clientAddress(request)}`, REDEEM_ATTEMPTS_PER_HOUR);
  if (!limit.allowed) {
    return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });
  }

  const parsed = RedeemSchema.safeParse(await request.json().catch(() => null));
  const invite = parsed.success ? await redeemInvite(db, parsed.data.code) : undefined;
  if (!invite) return Response.json({ error: "That code is not valid, or it has expired." }, { status: 401 });

  const maxAge = Math.max(1, Math.floor((invite.expiresAt.getTime() - Date.now()) / 1000));
  return Response.json(
    { ok: true, expiresAt: invite.expiresAt.toISOString() },
    { headers: { "set-cookie": setCookie(ACCESS_COOKIE, accessCookieValue(invite.id, invite.expiresAt), maxAge, "Lax") } },
  );
}

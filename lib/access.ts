import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { isValidSession, SESSION_COOKIE } from "./admin/auth";
import { getAdminPassword } from "./config";
import { isDatabaseConfigured } from "./db/client";
import type { Db } from "./db/knowledge-store";
import { invites } from "./db/schema";
import { readCookie } from "./http";

/**
 * Who may ask questions. In "invite" mode only the owner (signed in to /admin) and holders of a
 * valid invite; in "public" mode anyone, subject to the rate limit.
 */
export type AccessMode = "invite" | "public";

export const INVITE_HOURS = 24;
export const UNUSED_INVITE_DAYS = 14;
export const ACCESS_COOKIE = "access";

/**
 * ACCESS_MODE, defaulting to "invite" when a database is configured (invites are stored there) and
 * "public" otherwise, so the no-database demo works out of the box. Invite mode without a database
 * or without ADMIN_PASSWORD (nobody could create an invite) is a configuration error.
 */
export function getAccessMode(): AccessMode {
  const configured = process.env["ACCESS_MODE"]?.trim();
  const mode = configured || (isDatabaseConfigured() ? "invite" : "public");
  if (mode !== "invite" && mode !== "public") throw new Error(`ACCESS_MODE must be "invite" or "public", not "${mode}".`);
  if (mode === "invite" && !isDatabaseConfigured()) throw new Error("ACCESS_MODE=invite needs DATABASE_URL: invites are stored there.");
  if (mode === "invite" && !getAdminPassword()) throw new Error("ACCESS_MODE=invite needs ADMIN_PASSWORD: invites are created in /admin.");
  return mode;
}

/** No 0/O, 1/I/L: a code read out loud or typed from a phone should not fail on lookalikes. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]!);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** "k7q2 9xmp", "K7Q2-9XMP" and "k7q29xmp" are the same code. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashCode = (code: string) => createHash("sha256").update(normalizeCode(code)).digest("hex");

/** Only the hash is stored; the code is returned once, for the owner to send. */
export async function createInvite(db: Db, label: string, now = new Date()): Promise<{ id: string; code: string }> {
  const code = generateCode();
  const id = randomUUID();
  await db.insert(invites).values({ id, label: label.trim(), codeHash: hashCode(code), createdAt: now });
  return { id, code };
}

/**
 * Redeems a code. The first use starts the 24 hours (an invite unused for 14 days has expired);
 * later uses, from any device, are accepted until then. Returns undefined for anything invalid,
 * without saying why, so the response does not help guess codes.
 */
export async function redeemInvite(db: Db, code: string, now = new Date()): Promise<{ id: string; expiresAt: Date } | undefined> {
  const codeHash = hashCode(code);
  const expiresAt = new Date(now.getTime() + INVITE_HOURS * 3_600_000);
  const unusedCutoff = new Date(now.getTime() - UNUSED_INVITE_DAYS * 86_400_000);
  // First use: activate atomically, so two simultaneous first uses cannot both reset the clock.
  const [activated] = await db
    .update(invites)
    .set({ activatedAt: now, expiresAt })
    .where(and(eq(invites.codeHash, codeHash), isNull(invites.activatedAt), isNull(invites.revokedAt), gt(invites.createdAt, unusedCutoff)))
    .returning({ id: invites.id, expiresAt: invites.expiresAt });
  if (activated?.expiresAt) return { id: activated.id, expiresAt: activated.expiresAt };

  const [active] = await db
    .select({ id: invites.id, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(eq(invites.codeHash, codeHash), isNull(invites.revokedAt), gt(invites.expiresAt, now)));
  return active?.expiresAt ? { id: active.id, expiresAt: active.expiresAt } : undefined;
}

/** Checked on every request, so revoking takes effect immediately rather than when a cookie expires. */
export async function isInviteActive(db: Db, id: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.id, id), isNull(invites.revokedAt), gt(invites.expiresAt, now)));
  return Boolean(row);
}

export async function countInviteQuestion(db: Db, id: string): Promise<void> {
  await db.update(invites).set({ questionsAsked: sql`${invites.questionsAsked} + 1` }).where(eq(invites.id, id));
}

export async function revokeInvite(db: Db, id: string, now = new Date()): Promise<void> {
  await db.update(invites).set({ revokedAt: now }).where(eq(invites.id, id));
}

export type InviteStatus = "unused" | "active" | "expired" | "revoked";

export interface InviteSummary {
  id: string;
  label: string;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string | null;
  questionsAsked: number;
}

export async function listInvites(db: Db, now = new Date()): Promise<InviteSummary[]> {
  const rows = await db.select().from(invites).orderBy(desc(invites.createdAt));
  const unusedCutoff = now.getTime() - UNUSED_INVITE_DAYS * 86_400_000;
  return rows.map((row) => {
    const status: InviteStatus = row.revokedAt
      ? "revoked"
      : row.expiresAt
        ? row.expiresAt > now
          ? "active"
          : "expired"
        : row.createdAt.getTime() > unusedCutoff
          ? "unused"
          : "expired";
    return {
      id: row.id,
      label: row.label,
      status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      questionsAsked: row.questionsAsked,
    };
  });
}

/** Keyed from ADMIN_PASSWORD (separately from admin sessions): changing it ends every invite session. */
function sign(payload: string): string {
  const password = getAdminPassword();
  if (!password) throw new Error("ADMIN_PASSWORD is not set.");
  return createHmac("sha256", `access-v1:${password}`).update(payload).digest("hex");
}

/** `<invite id>.<expiry ms>.<hmac>`. */
export function accessCookieValue(inviteId: string, expiresAt: Date): string {
  const payload = `${inviteId}.${expiresAt.getTime()}`;
  return `${payload}.${sign(payload)}`;
}

export function readAccessCookie(value: string | undefined, now = new Date()): { inviteId: string } | undefined {
  if (!value || !getAdminPassword()) return undefined;
  const [inviteId, expires, signature] = value.split(".");
  if (!inviteId || !expires || !signature || !/^\d+$/.test(expires) || Number(expires) <= now.getTime()) return undefined;
  const expected = Buffer.from(sign(`${inviteId}.${expires}`));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? { inviteId } : undefined;
}

export interface Access {
  allowed: boolean;
  /** Set for invite holders, so their conversation and question count are attributed to the invite. */
  inviteId?: string;
}

/** The one gate every visitor-facing API route goes through. */
export async function resolveAccess(request: Request, db: Db | undefined, now = new Date()): Promise<Access> {
  if (getAccessMode() === "public") return { allowed: true };
  if (isValidSession(readCookie(request, SESSION_COOKIE))) return { allowed: true };
  const cookie = readAccessCookie(readCookie(request, ACCESS_COOKIE), now);
  if (cookie && db && (await isInviteActive(db, cookie.inviteId, now))) return { allowed: true, inviteId: cookie.inviteId };
  return { allowed: false };
}

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accessCookieValue,
  createInvite,
  generateCode,
  getAccessMode,
  isInviteActive,
  listInvites,
  readAccessCookie,
  redeemInvite,
  resolveAccess,
  revokeInvite,
} from "../lib/access";
import { createSession } from "../lib/admin/auth";
import type { Db } from "../lib/db/knowledge-store";

const HOUR = 3_600_000;
const t0 = new Date("2026-10-08T00:00:00Z");
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);

let db: Db;
beforeEach(async () => {
  const raw = drizzle(new PGlite());
  await migrate(raw, { migrationsFolder: "drizzle" });
  db = raw as unknown as Db;
  vi.stubEnv("ADMIN_PASSWORD", "owner-password");
  vi.stubEnv("DATABASE_URL", "postgres://configured");
});
afterEach(() => vi.unstubAllEnvs());

describe("invite codes", () => {
  it("are 8 unambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });

  it("last 24 hours from first use, on any device, however the code is typed", async () => {
    const { code } = await createInvite(db, "Acme recruiter", t0);
    const first = await redeemInvite(db, code, at(48));
    expect(first?.expiresAt).toEqual(at(72));
    const again = await redeemInvite(db, code.toLowerCase().replace("-", " "), at(60));
    expect(again?.expiresAt).toEqual(at(72));
    expect(await redeemInvite(db, code, at(72.01))).toBeUndefined();
  });

  it("expire unused after 14 days", async () => {
    const { code } = await createInvite(db, "Late reader", t0);
    expect(await redeemInvite(db, code, at(14 * 24 + 1))).toBeUndefined();
  });

  it("stop working the moment they are revoked", async () => {
    const { id, code } = await createInvite(db, "Acme", t0);
    await redeemInvite(db, code, at(1));
    expect(await isInviteActive(db, id, at(2))).toBe(true);
    await revokeInvite(db, id, at(2));
    expect(await isInviteActive(db, id, at(3))).toBe(false);
    expect(await redeemInvite(db, code, at(3))).toBeUndefined();
    expect((await listInvites(db, at(3)))[0]).toMatchObject({ label: "Acme", status: "revoked" });
  });

  it("reject wrong codes and never store the code itself", async () => {
    const { code } = await createInvite(db, "Acme", t0);
    expect(await redeemInvite(db, "ABCD-EFGH", at(1))).toBeUndefined();
    const rows = await db.execute(`select * from invites` as never);
    expect(JSON.stringify(rows)).not.toContain(code.replace("-", ""));
  });
});

describe("access cookie", () => {
  it("is accepted until its expiry and rejected when tampered with", () => {
    const value = accessCookieValue("invite-1", at(24));
    expect(readAccessCookie(value, at(1))).toEqual({ inviteId: "invite-1" });
    expect(readAccessCookie(value, at(25))).toBeUndefined();
    expect(readAccessCookie(value.replace("invite-1", "invite-2"), at(1))).toBeUndefined();
    const [id, , signature] = value.split(".");
    expect(readAccessCookie(`${id}.${at(999).getTime()}.${signature}`, at(1))).toBeUndefined();
  });

  it("stops working when the owner changes ADMIN_PASSWORD", () => {
    const value = accessCookieValue("invite-1", at(24));
    vi.stubEnv("ADMIN_PASSWORD", "new-password");
    expect(readAccessCookie(value, at(1))).toBeUndefined();
  });
});

describe("the gate", () => {
  const request = (cookie?: string) => new Request("http://localhost/api/ask", cookie ? { headers: { cookie } } : {});

  it("defaults to invite mode with a database and public mode without one", () => {
    expect(getAccessMode()).toBe("invite");
    vi.stubEnv("DATABASE_URL", "");
    expect(getAccessMode()).toBe("public");
    vi.stubEnv("ACCESS_MODE", "invite");
    expect(() => getAccessMode()).toThrow(/DATABASE_URL/);
  });

  it("lets in the owner, a valid invite, and nobody else", async () => {
    expect((await resolveAccess(request(), db)).allowed).toBe(false);
    expect((await resolveAccess(request(`admin_session=${encodeURIComponent(createSession())}`), db)).allowed).toBe(true);

    const now = new Date();
    const { id, code } = await createInvite(db, "Acme", now);
    const redeemed = (await redeemInvite(db, code, now))!;
    const cookie = `access=${encodeURIComponent(accessCookieValue(id, redeemed.expiresAt))}`;
    expect(await resolveAccess(request(cookie), db)).toEqual({ allowed: true, inviteId: id });

    await revokeInvite(db, id);
    expect((await resolveAccess(request(cookie), db)).allowed).toBe(false);
  });

  it("lets everyone in when ACCESS_MODE is public", async () => {
    vi.stubEnv("ACCESS_MODE", "public");
    expect((await resolveAccess(request(), db)).allowed).toBe(true);
  });
});

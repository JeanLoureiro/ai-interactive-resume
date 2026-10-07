import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getAdminPassword } from "../config";

export const SESSION_COOKIE = "admin_session";
export const SESSION_HOURS = 8;

export function isAdminEnabled(): boolean {
  return getAdminPassword() !== undefined;
}

/** Hashing both sides first gives equal lengths, so the comparison itself is constant-time. */
export function passwordMatches(candidate: string): boolean {
  const password = getAdminPassword();
  if (!password || !candidate) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(password));
}

/** Keyed from the password, so changing ADMIN_PASSWORD invalidates every existing session. */
function sign(payload: string): string {
  const password = getAdminPassword();
  if (!password) throw new Error("Admin is disabled: ADMIN_PASSWORD is not set.");
  return createHmac("sha256", `admin-session-v1:${password}`).update(payload).digest("hex");
}

/** `<expiry ms>.<hmac>`: nothing secret inside, just a signed expiry. */
export function createSession(): string {
  const expires = String(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  return `${expires}.${sign(expires)}`;
}

export function isValidSession(cookie: string | undefined): boolean {
  if (!cookie || !isAdminEnabled()) return false;
  const [expires, signature] = cookie.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sign(expires));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Failed logins per address, per server instance: 10 per 15 minutes.
 *
 * Per instance only, so it slows guessing rather than capping it globally. A long random
 * ADMIN_PASSWORD is the real defence; the README says so.
 */
export const loginThrottle = (() => {
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_FAILURES = 10;
  const failures = new Map<string, number[]>();
  const recent = (address: string) => (failures.get(address) ?? []).filter((at) => at > Date.now() - WINDOW_MS);
  return {
    isBlocked: (address: string) => recent(address).length >= MAX_FAILURES,
    recordFailure: (address: string) => failures.set(address, [...recent(address), Date.now()]),
    reset: () => failures.clear(),
  };
})();

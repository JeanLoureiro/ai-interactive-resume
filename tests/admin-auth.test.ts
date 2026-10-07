import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, isAdminEnabled, isValidSession, loginThrottle, passwordMatches } from "../lib/admin/auth";

beforeEach(() => vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  loginThrottle.reset();
});

describe("admin auth", () => {
  it("does not exist without ADMIN_PASSWORD", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(isAdminEnabled()).toBe(false);
    expect(passwordMatches("")).toBe(false);
    expect(isValidSession(createSessionSafely())).toBe(false);
  });

  it("checks the password exactly", () => {
    expect(passwordMatches("correct horse battery staple")).toBe(true);
    expect(passwordMatches("correct horse battery stapl")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });

  it("accepts its own session and rejects a tampered one", () => {
    const session = createSession();
    expect(isValidSession(session)).toBe(true);
    const [expires, signature] = session.split(".");
    expect(isValidSession(`${Number(expires) + 86_400_000}.${signature}`)).toBe(false);
    expect(isValidSession(`${expires}.${"0".repeat(signature!.length)}`)).toBe(false);
    expect(isValidSession(undefined)).toBe(false);
  });

  it("expires sessions", () => {
    vi.useFakeTimers();
    const session = createSession();
    vi.advanceTimersByTime(9 * 60 * 60 * 1000);
    expect(isValidSession(session)).toBe(false);
  });

  it("logs everyone out when the password changes", () => {
    const session = createSession();
    vi.stubEnv("ADMIN_PASSWORD", "a new password");
    expect(isValidSession(session)).toBe(false);
  });

  it("throttles repeated failed logins from one address", () => {
    for (let i = 0; i < 10; i++) loginThrottle.recordFailure("203.0.113.7");
    expect(loginThrottle.isBlocked("203.0.113.7")).toBe(true);
    expect(loginThrottle.isBlocked("203.0.113.8")).toBe(false);
  });
});

function createSessionSafely(): string {
  try {
    return createSession();
  } catch {
    return "";
  }
}

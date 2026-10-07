import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/cron/keepalive/route";

const call = (authorization?: string) =>
  GET(new Request("http://localhost/api/cron/keepalive", authorization ? { headers: { authorization } } : {}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("keep-alive cron route", () => {
  it("rejects every request when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call()).status).toBe(401);
  });

  it("rejects a missing or wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong!")).status).toBe(401);
  });

  it("accepts the right secret and reports when no database is configured", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, database: "not configured" });
  });
});

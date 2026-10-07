import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "../app/api/admin/login/route";
import { POST as upload } from "../app/api/admin/resume/route";
import { POST as publish } from "../app/api/admin/publish/route";
import { createSession, loginThrottle } from "../lib/admin/auth";

const ORIGIN = "http://localhost:3000";
const post = (path: string, init: { body?: BodyInit; cookie?: string; origin?: string | null; json?: unknown } = {}) => {
  const headers = new Headers();
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
};

beforeEach(() => vi.stubEnv("ADMIN_PASSWORD", "s3cret-admin"));
afterEach(() => {
  vi.unstubAllEnvs();
  loginThrottle.reset();
});

describe("admin routes", () => {
  it("are a plain 404 when ADMIN_PASSWORD is not set", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect((await login(post("/api/admin/login", { json: { password: "x" } }))).status).toBe(404);
    expect((await publish(post("/api/admin/publish"))).status).toBe(404);
  });

  it("refuse cross-site and origin-less requests", async () => {
    expect((await login(post("/api/admin/login", { json: { password: "s3cret-admin" }, origin: "https://evil.example" }))).status).toBe(403);
    expect((await login(post("/api/admin/login", { json: { password: "s3cret-admin" }, origin: null }))).status).toBe(403);
  });

  it("set an httpOnly, SameSite=Strict session cookie only for the right password", async () => {
    expect((await login(post("/api/admin/login", { json: { password: "nope" } }))).status).toBe(401);
    const ok = await login(post("/api/admin/login", { json: { password: "s3cret-admin" } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/admin_session=.+; Path=\/; HttpOnly; SameSite=Strict/);
  });

  it("block a password after repeated failures from one address", async () => {
    for (let i = 0; i < 10; i++) await login(post("/api/admin/login", { json: { password: "nope" } }));
    expect((await login(post("/api/admin/login", { json: { password: "s3cret-admin" } }))).status).toBe(429);
  });

  it("require a valid session to upload or publish", async () => {
    expect((await upload(post("/api/admin/resume"))).status).toBe(401);
    expect((await publish(post("/api/admin/publish", { cookie: "admin_session=123.abc" }))).status).toBe(401);
  });

  it("say a database is needed rather than accept an upload they cannot store", async () => {
    const cookie = `admin_session=${encodeURIComponent(createSession())}`;
    const response = await upload(post("/api/admin/resume", { cookie, body: new FormData() }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/DATABASE_URL/);
  });
});

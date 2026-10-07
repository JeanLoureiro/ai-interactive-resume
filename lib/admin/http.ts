import { isAdminEnabled, isValidSession, SESSION_COOKIE, SESSION_HOURS } from "./auth";

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/** First hop of x-forwarded-for, as set by Vercel; used only to throttle logins. */
export function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Admin POSTs must come from the admin page itself. The session cookie is SameSite=Strict already;
 * checking Origin as well means a missing or forged cookie policy is not the only defence.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && new URL(origin).host === new URL(request.url).host;
}

/**
 * The gate every admin route goes through. Returns a response to send instead, or undefined to
 * continue. Disabled admin is a plain 404: an unconfigured deployment does not advertise /admin.
 */
export function guardAdminRequest(request: Request, { requireSession = true } = {}): Response | undefined {
  if (!isAdminEnabled()) return new Response("Not found", { status: 404 });
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  if (requireSession && !isValidSession(readCookie(request, SESSION_COOKIE))) {
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  }
  return undefined;
}

export function sessionCookie(value: string): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

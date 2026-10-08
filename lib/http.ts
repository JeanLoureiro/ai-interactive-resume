/** Small request helpers shared by the visitor and admin routes. */

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/** First hop of x-forwarded-for, as set by Vercel. Used for rate limits only, and only hashed. */
export function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const secure = () => (process.env["NODE_ENV"] === "production" ? "; Secure" : "");

export function setCookie(name: string, value: string, maxAgeSeconds: number, sameSite: "Strict" | "Lax"): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secure()}`;
}

export function clearCookie(name: string, sameSite: "Strict" | "Lax"): string {
  return `${name}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0`;
}

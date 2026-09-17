/** Shared site password gate (Vercel Edge Middleware + /api/login). */

export const AUTH_COOKIE = "paketo_auth";

/** Default shared password. Override with SITE_PASSWORD on Vercel. */
export const DEFAULT_SITE_PASSWORD = "paketoheslo01";

const TOKEN_PREFIX = "paketo-auth-v1:";

export function getSitePassword(): string {
  return process.env.SITE_PASSWORD?.trim() || DEFAULT_SITE_PASSWORD;
}

export async function authTokenForPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${TOKEN_PREFIX}${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function expectedAuthToken(): Promise<string> {
  return authTokenForPassword(getSitePassword());
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function buildAuthCookie(token: string, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  // 30 days
  return `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login.html" ||
    pathname === "/api/login" ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon.ico"
  );
}

import { constantTimeEquals } from "./secure-compare";

// ---------------------------------------------------------------------
// Admin session tokens (pure crypto, no request context).
//
// Kept apart from admin-session.ts so the signing logic can be unit-tested
// without a live request: that module pulls in cookie helpers that only
// resolve inside a server-function call.
//
// Token shape: `v1.<expiresAtSeconds>.<signature>`, where the signature is
// HMAC-SHA256 over `v1.<expiresAtSeconds>` using a key derived from the
// admin secret. Stateless on purpose — this deploys as a Worker, so there
// is no process that could hold a session table, and a stateless token
// survives instance churn.
// ---------------------------------------------------------------------

export const ADMIN_SESSION_COOKIE = "lp_admin";
/** Eight hours: a working day, and short enough that a leaked cookie ages out. */
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const TOKEN_VERSION = "v1";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signingKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`lambda-prep/admin-session:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await signingKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(new Uint8Array(signature));
}

/** Opaque session token for the given passcode secret. */
export async function createAdminSessionToken(secret: string, now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  return `${payload}.${await sign(payload, secret)}`;
}

/** True when `token` is well-formed, unexpired, and correctly signed. */
export async function verifyAdminSessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiresRaw, signature] = parts as [string, string, string];
  if (version !== TOKEN_VERSION) return false;
  if (!/^\d{1,12}$/.test(expiresRaw)) return false;
  const expiresAt = Number(expiresRaw);
  const nowSeconds = Math.floor(now / 1000);
  // Expired tokens are refused; so are tokens claiming an expiry further out
  // than the TTL, which would mean the clock (or the token) is not ours.
  if (expiresAt <= nowSeconds) return false;
  if (expiresAt > nowSeconds + ADMIN_SESSION_TTL_SECONDS) return false;
  const expected = await sign(`${version}.${expiresRaw}`, secret);
  return constantTimeEquals(signature, expected);
}

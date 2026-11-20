// ---------------------------------------------------------------------
// Admin session cookie.
//
// The admin panel used to re-send the passcode on every server-function
// call: it travelled in ~20 request bodies per panel visit, sat in React
// state, and was one screenshot of devtools away from being read out.
//
// Instead, the passcode is exchanged once for a signed cookie:
//   - HttpOnly, so page script (and anything injected into it) can't read it;
//   - SameSite=Strict, so another origin can't drive an authenticated call;
//   - Secure whenever the request arrived over https;
//   - short TTL (see admin-token.ts), after which the panel locks itself.
//
// The token itself is described in admin-token.ts. The cookie holds the
// derived signing secret's output, never the passcode.
// ---------------------------------------------------------------------

import { deleteCookie, getCookie, getRequestProtocol, setCookie } from "@tanstack/react-start/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "./admin-token";

/** Issues the session cookie on the outgoing response. */
export async function setAdminSessionCookie(secret: string): Promise<void> {
  const token = await createAdminSessionToken(secret);
  setCookie(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: getRequestProtocol({ xForwardedProto: true }) === "https",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export function clearAdminSessionCookie(): void {
  deleteCookie(ADMIN_SESSION_COOKIE, { path: "/" });
}

/** Reads and verifies the cookie on the current request. */
export async function hasAdminSession(secret: string): Promise<boolean> {
  return verifyAdminSessionToken(getCookie(ADMIN_SESSION_COOKIE), secret);
}

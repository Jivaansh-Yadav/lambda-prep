import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { resolveShortRedirect } from "./lib/redirects";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Security response headers. Applied in the server entry (rather than only
// in `public/_headers`, which is a Cloudflare Pages convention the current
// host ignores) so they ride along with every document this app serves.
//
// The CSP is scoped to what the app actually loads:
//   - drive.google.com        -> resource PDF previews (resource-watch)
//   - fonts.googleapis.com / fonts.gstatic.com -> DM Sans + Manrope
// 'unsafe-inline' for scripts is a deliberate, documented compromise: TanStack
// Start inlines its hydration and stream-boundary scripts on every document,
// and their contents differ per route, so neither a static hash nor a
// build-time nonce can cover them. Removing the directive without framework
// nonce support would break hydration on every page. What is left is narrowed:
// script-src-attr 'none' refuses inline *event handler* attributes (the usual
// payload of an HTML injection), and every sink the app actually needs is in
// the allowlists below. The JSON-LD block in __root.tsx is data
// (application/ld+json), not an executable script, so it is not governed by
// script-src at all.
//
// frame-ancestors allows https://*.e2b.app and https://*.eazo.dev/.ai — the
// Eazo sandbox preview host and production alias domains that embed this app
// in their own iframe (Creator's live Preview panel and in-app QR/test links).
// Without them the host shows its own clickjacking block page instead of the
// app. /admin opts out of that allowlist entirely: it is never meant to be
// embedded, and a framed admin panel is a clickjacking target (GH issue #6).
// ---------------------------------------------------------------------
const BASE_CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // static.cloudflareinsights.com is the Cloudflare Web Analytics (RUM) beacon
  // loaded from __root.tsx; cloudflareinsights.com is where it POSTs its
  // measurements. Without both hosts the browser blocks the beacon and the
  // admin "Deep analytics" panel stays empty forever.
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://drive.google.com",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-src 'self' https://drive.google.com https://docs.google.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
];

/** Everyone who may frame the public site (Eazo preview + production aliases). */
const PUBLIC_FRAME_ANCESTORS = "frame-ancestors 'self' https://*.e2b.app https://*.eazo.dev https://*.eazo.ai";

/** The admin panel is never embedded, not even by those hosts. */
const ADMIN_FRAME_ANCESTORS = "frame-ancestors 'none'";

/** True for /admin and everything below it. */
function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function contentSecurityPolicy(pathname: string): string {
  const ancestors = isAdminPath(pathname) ? ADMIN_FRAME_ANCESTORS : PUBLIC_FRAME_ANCESTORS;
  return [...BASE_CSP_DIRECTIVES, ancestors].join("; ");
}

function securityHeaders(pathname: string): ReadonlyArray<readonly [string, string]> {
  return [
    ["Content-Security-Policy", contentSecurityPolicy(pathname)],
    // No X-Frame-Options header here: per the HTML/CSP spec, an enforced CSP
    // frame-ancestors directive makes browsers ignore X-Frame-Options, but it
    // is per-response - if a route sets X-Frame-Options itself and skips CSP,
    // SAMEORIGIN would silently re-block the Eazo preview iframe. Omitting it
    // keeps the allowlist in one place (frame-ancestors above); every current
    // browser enforces that directive, and the app registers nothing that
    // needs the IE/old-Safari-only fallback.
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    // Fullscreen is granted to self and to the embedded PDF viewer: the
    // resource viewer requests fullscreen on its own document, and Drive's
    // PDF viewer carries its own fullscreen button inside the frame. An
    // iframe `allow` attribute can only narrow this policy, never widen it,
    // so without this origin that button is a dead control.
    [
      "Permissions-Policy",
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self "https://drive.google.com")',
    ],
    ["Cross-Origin-Opener-Policy", "same-origin"],
  ];
}

function withSecurityHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  // Never clobber a header a route set deliberately.
  for (const [name, value] of securityHeaders(pathname)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Short links (/drive, /github). public/_redirects covers hosts that read
    // it for edge-served requests; this covers the SSR entry, which some hosts
    // hand every request to before any redirect file is consulted.
    const url = new URL(request.url);
    const shortLink = resolveShortRedirect(url);
    if (shortLink) {
      return new Response(null, {
        status: 302,
        headers: { location: shortLink, "cache-control": "public, max-age=300" },
      });
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), url.pathname);
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        url.pathname,
      );
    }
  },
};

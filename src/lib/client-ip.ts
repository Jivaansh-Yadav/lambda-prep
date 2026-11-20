// ---------------------------------------------------------------------
// One definition of "who is calling", for every rate limiter.
//
// The old helpers each called `getRequestIP({ xForwardedFor: true })`,
// which blindly trusts whatever header arrives. Behind Cloudflare that is
// fine, but it also means the limiter's key is caller-controlled: rotate
// `X-Forwarded-For` and every bucket is new.
//
// Resolution order, most trustworthy first:
//   1. `cf-connecting-ip` — written by Cloudflare's edge and stripped from
//      the incoming request, so a client cannot forge it.
//   2. the first hop of `X-Forwarded-For` — what Vercel and Cloudflare set,
//      and the only entry the edge did not copy from the caller.
//   3. the platform's own `getRequestIP()`.
//   4. `"unknown"`, which buckets all unresolved callers together rather
//      than handing each one its own allowance.
// ---------------------------------------------------------------------

import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";

/** The caller's IP, or `"unknown"` outside a request context. */
export function clientIp(): string {
  try {
    const cloudflare = getRequestHeader("cf-connecting-ip");
    if (cloudflare?.trim()) return cloudflare.trim();

    const forwarded = getRequestHeader("x-forwarded-for");
    const firstHop = forwarded?.split(",")[0]?.trim();
    if (firstHop) return firstHop;

    return getRequestIP() ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Composes a limiter key so two counters on the same IP never collide. */
export function rateLimitKey(scope: string, ...parts: Array<string | null | undefined>): string {
  return [scope, clientIp(), ...parts.filter((part): part is string => Boolean(part))].join("|");
}

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { sql } from "./db";

// ---------------------------------------------------------------------
// Outbound clicks (table: outbound_clicks).
//
// The site links out to a handful of external destinations — today only
// Doxxmarks. Cloudflare's RUM dataset cannot see a link that opens another
// site in a new tab, so "how many visitors did we send to Doxxmarks" has no
// answer from page views: the click happens on our page and the navigation
// happens elsewhere.
//
// The browser therefore records the click itself (outbound-tracking.ts) with
// a sessionStorage marker, so one session contributes at most one row per
// entry point regardless of reloads or repeat clicks. COUNT(*) reads as
// "sessions sent to the destination", which is the number the admin panel
// shows.
// ---------------------------------------------------------------------

/** Longest stored value per column, matching the table's TEXT columns but
 * capped so a hostile payload cannot write a novel into Neon. */
const MAX_LENGTHS = {
  destination: 32,
  entry: 32,
  board: 16,
  classSlug: 32,
  subject: 96,
  path: 200,
} as const;

/** Values are matched against an allowlist before they ever reach SQL, so an
 * unknown destination or entry point is a client bug, not stored data. */
export const OUTBOUND_DESTINATIONS = ["doxxmarks"] as const;
export type OutboundDestination = (typeof OUTBOUND_DESTINATIONS)[number];

export const OUTBOUND_ENTRIES = ["lp", "class-hub"] as const;
export type OutboundEntry = (typeof OUTBOUND_ENTRIES)[number];

/** Normalises a display-ish value (board, subject) into a storable slug:
 * whitespace collapsed, control characters and quotes removed, length capped.
 * Exported for the test suite. */
export function normalizeOutboundValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  // Drop markup characters outright, then keep only printable characters —
  // building the string from code units instead of matching a control-character
  // regex, which eslint (rightly) refuses.
  const withoutMarkup = value.replace(/["<>]/g, "");
  const cleaned = Array.from(withoutMarkup)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : null;
}

// Per-IP brake on the public write, same shape as campaign_visits: in-memory,
// resets on deploy, generous enough that a real session (which writes at most
// once per entry point) never reaches it.
const WRITE_WINDOW_MS = 10 * 60 * 1000;
const MAX_WRITES_PER_WINDOW = 30;
const writesByIp = new Map<string, { count: number; windowStart: number }>();

function withinWriteLimit(ip: string): boolean {
  const now = Date.now();
  const rec = writesByIp.get(ip);
  if (!rec || now - rec.windowStart > WRITE_WINDOW_MS) {
    writesByIp.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (rec.count >= MAX_WRITES_PER_WINDOW) return false;
  rec.count += 1;
  return true;
}

function readClientIp(): string {
  try {
    return getRequestIP({ xForwardedFor: true }) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function readCountry(): string | null {
  try {
    const value = getRequestHeader("cf-ipcountry");
    return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export type OutboundClickResult = { ok: boolean };

/**
 * Records one outbound click. Always resolves: a failed write must never stop
 * the visitor from reaching the destination they clicked.
 */
export const recordOutboundClick = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as {
      destination?: unknown;
      entry?: unknown;
      board?: unknown;
      classSlug?: unknown;
      subject?: unknown;
      path?: unknown;
    };

    if (typeof d?.destination !== "string" || !(OUTBOUND_DESTINATIONS as readonly string[]).includes(d.destination)) {
      throw new Error("Invalid destination");
    }
    if (typeof d?.entry !== "string" || !(OUTBOUND_ENTRIES as readonly string[]).includes(d.entry)) {
      throw new Error("Invalid entry");
    }

    return {
      destination: d.destination as OutboundDestination,
      entry: d.entry as OutboundEntry,
      board: normalizeOutboundValue(d.board, MAX_LENGTHS.board),
      classSlug: normalizeOutboundValue(d.classSlug, MAX_LENGTHS.classSlug),
      subject: normalizeOutboundValue(d.subject, MAX_LENGTHS.subject),
      path: normalizeOutboundValue(d.path, MAX_LENGTHS.path),
    };
  })
  .handler(async ({ data }): Promise<OutboundClickResult> => {
    if (!sql) return { ok: false };
    if (!withinWriteLimit(readClientIp())) return { ok: false };

    try {
      await sql.query(
        `INSERT INTO outbound_clicks (destination, entry, board, class_slug, subject, path, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [data.destination, data.entry, data.board, data.classSlug, data.subject, data.path, readCountry()],
      );
      return { ok: true };
    } catch (error) {
      console.error("[outbound] failed to record click", error);
      return { ok: false };
    }
  });

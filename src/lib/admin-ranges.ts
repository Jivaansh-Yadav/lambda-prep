// admin-ranges.ts
//
// The four lookback windows the admin analytics panels share. Pure
// constants + helpers so both the client (labels, selector order) and the
// server (queries) read from one list, and so the window maths can be
// unit tested without a database or a Cloudflare credential.
//
// "24h" is the default everywhere: the dashboard is a "what is happening
// now" surface, and a month-wide default made every number read as
// background noise.

export const ADMIN_RANGES = ["24h", "7d", "14d", "30d"] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];

/** Default window for every analytics panel, chart and stats table. */
export const ADMIN_DEFAULT_RANGE: AdminRange = "24h";

export function isAdminRange(value: unknown): value is AdminRange {
  return typeof value === "string" && (ADMIN_RANGES as readonly string[]).includes(value);
}

/** Milliseconds of lookback, for tables keyed by a real timestamp
 * (traffic hours, RUM days, ratings, comments, shares). */
export const RANGE_WINDOW_MS: Record<AdminRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Whole calendar days of lookback, for tables that only store a day
 * bucket (`resource_daily_views`). Counted inclusively of today, so 24h
 * means "the current IST day" — the finest granularity that table has. */
export const RANGE_DAY_COUNT: Record<AdminRange, number> = {
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

export const ADMIN_RANGE_LABEL: Record<AdminRange, string> = {
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
};

// ---------------------------------------------------------------------
// Analytics windows
// ---------------------------------------------------------------------
// The Cloudflare-backed analytics panels offer two windows the database
// tables above cannot: "all" (everything Cloudflare still retains) and
// "custom" (an explicit from/to pair). They live in their own list because
// their window is not a fixed number of milliseconds — it needs the picked
// dates — so only the analytics queries can resolve them. The resource
// stats tables keep the four fixed windows.

export const ANALYTICS_RANGES = ["24h", "7d", "14d", "30d", "all", "custom"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return typeof value === "string" && (ANALYTICS_RANGES as readonly string[]).includes(value);
}

/** How far back Cloudflare's Web Analytics (RUM) dataset will answer at all:
 * a query whose start is older than ~26 weeks is rejected outright, so that
 * retention floor also bounds "All time" and any custom start date. */
export const ANALYTICS_MAX_AGE_DAYS = 180;

/** Short menu labels — ADMIN_RANGE_LABEL reads as a sentence fragment
 * ("Traffic — last 30 days"), which is wrong inside a dropdown. */
export const ANALYTICS_RANGE_OPTION_LABEL: Record<AnalyticsRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "14d": "Last 14 days",
  "30d": "Last 30 days",
  all: "All time",
  custom: "Custom range…",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A resolved query window: the absolute bounds sent to Cloudflare, the
 * bucket granularity they are read at, and the cache key derived from the
 * selection. Fixed windows key on the range string; a custom span keys on
 * its own dates so two different spans never share a cached payload. */
export type AnalyticsWindow = {
  /** Inclusive lower bound. */
  since: Date;
  /** Exclusive upper bound. */
  until: Date;
  bucket: "hour" | "day";
  cacheKey: string;
};

function parseDateOnly(value: string, field: string): Date {
  if (!DATE_ONLY_RE.test(value)) throw new Error(`Invalid ${field}: expected YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}

/**
 * Turns a range selection into concrete query bounds. Throws on a
 * malformed, backwards, or too-old custom span so the server function's
 * validator rejects it with a readable message before any Cloudflare call
 * is made.
 */
export function resolveAnalyticsWindow(
  range: AnalyticsRange,
  from?: string,
  to?: string,
  now: number = Date.now()
): AnalyticsWindow {
  if (range === "all") {
    return {
      since: new Date(now - ANALYTICS_MAX_AGE_DAYS * DAY_MS),
      until: new Date(now),
      bucket: "day",
      cacheKey: "all",
    };
  }

  if (range === "custom") {
    if (!from || !to) throw new Error("A custom range needs both a start and an end date");
    const start = parseDateOnly(from, "start date");
    // `to` is inclusive in the UI, so the exclusive upper bound is the day
    // after — clamped to now, since Cloudflare rejects a window that ends in
    // the future and "today" is the common end date.
    const end = Math.min(parseDateOnly(to, "end date").getTime() + DAY_MS, now);
    if (end <= start.getTime()) throw new Error("The end date must be on or after the start date");

    const oldestAvailable = now - ANALYTICS_MAX_AGE_DAYS * DAY_MS;
    if (start.getTime() < oldestAvailable) {
      throw new Error(
        `Cloudflare only retains ${ANALYTICS_MAX_AGE_DAYS} days of Web Analytics data — pick a start date on or after ${new Date(oldestAvailable).toISOString().slice(0, 10)}.`
      );
    }

    const days = Math.round((end - start.getTime()) / DAY_MS);
    // Short spans read better hour by hour (a one-day custom range would
    // otherwise be a single point); anything longer buckets by day.
    const bucket: "hour" | "day" = days <= 3 ? "hour" : "day";
    return { since: start, until: new Date(end), bucket, cacheKey: `custom:${from}:${to}:${bucket}` };
  }

  return {
    since: new Date(now - RANGE_WINDOW_MS[range]),
    until: new Date(now),
    bucket: range === "24h" ? "hour" : "day",
    cacheKey: range,
  };
}

/** Compact label for a KPI card title ("Page loads (all time)", "Page loads
 * (27 Oct – 25 Nov)") where the full sentence would wrap the card. */
export function analyticsRangeShortLabel(range: AnalyticsRange, from?: string, to?: string): string {
  if (range === "all") return "all time";
  if (range !== "custom") return range;
  if (!from || !to) return "custom";
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    return new Date(Date.UTC(y, m - 1, d) + 12 * 60 * 60 * 1000).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

/** Human label for a selection, so every card heading says which window it
 * describes: the fixed windows keep their ADMIN_RANGE_LABEL phrasing and a
 * custom span is spelled out as its two dates. */
export function analyticsRangeLabel(range: AnalyticsRange, from?: string, to?: string): string {
  if (range === "all") return "all time";
  if (range !== "custom") return ADMIN_RANGE_LABEL[range];
  if (!from || !to) return "the selected dates";
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    return new Date(Date.UTC(y, m - 1, d) + 12 * 60 * 60 * 1000).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

/** Start of the window, as a Date — the `$1::timestamptz` every
 * timestamp-keyed query filters on. */
export function rangeStart(range: AdminRange, now: number = Date.now()): Date {
  return new Date(now - RANGE_WINDOW_MS[range]);
}

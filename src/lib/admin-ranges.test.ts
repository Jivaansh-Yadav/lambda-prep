import { describe, expect, it } from "vitest";
import {
  ADMIN_DEFAULT_RANGE,
  ADMIN_RANGES,
  ADMIN_RANGE_LABEL,
  ANALYTICS_MAX_AGE_DAYS,
  ANALYTICS_RANGES,
  ANALYTICS_RANGE_OPTION_LABEL,
  RANGE_DAY_COUNT,
  RANGE_WINDOW_MS,
  analyticsDayBounds,
  analyticsRangeLabel,
  analyticsRangeShortLabel,
  isAdminRange,
  isAnalyticsRange,
  rangeStart,
  resolveAnalyticsWindow,
} from "./admin-ranges";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("admin analytics ranges", () => {
  it("defaults to 24h, not the old 30d", () => {
    expect(ADMIN_DEFAULT_RANGE).toBe("24h");
    expect(ADMIN_RANGES[0]).toBe(ADMIN_DEFAULT_RANGE);
  });

  it("labels every range and keeps the list ordered narrow to wide", () => {
    for (const range of ADMIN_RANGES) {
      expect(ADMIN_RANGE_LABEL[range]).toMatch(/^last /);
    }
    const windows = ADMIN_RANGES.map((r) => RANGE_WINDOW_MS[r]);
    expect(windows).toEqual([...windows].sort((a, b) => a - b));
  });

  it("counts whole days only for the day-bucketed tables", () => {
    expect(RANGE_DAY_COUNT["24h"]).toBe(1);
    expect(RANGE_DAY_COUNT["30d"]).toBe(RANGE_WINDOW_MS["30d"] / (24 * 60 * 60 * 1000));
  });

  it("rangeStart moves back exactly one window from now", () => {
    const now = Date.UTC(2026, 10, 17, 12, 0, 0);
    expect(rangeStart("24h", now).toISOString()).toBe("2026-11-16T12:00:00.000Z");
    expect(rangeStart("7d", now).toISOString()).toBe("2026-11-10T12:00:00.000Z");
  });

  it("rejects anything that is not a known range", () => {
    expect(isAdminRange("24h")).toBe(true);
    expect(isAdminRange("90d")).toBe(false);
    expect(isAdminRange(undefined)).toBe(false);
    expect(isAdminRange(7)).toBe(false);
  });
});

describe("analytics windows", () => {
  it("offers the fixed windows plus all time and a custom span", () => {
    for (const range of ADMIN_RANGES) expect(ANALYTICS_RANGES).toContain(range);
    expect(ANALYTICS_RANGES).toContain("all");
    expect(ANALYTICS_RANGES).toContain("custom");
    for (const range of ANALYTICS_RANGES) expect(ANALYTICS_RANGE_OPTION_LABEL[range]).toBeTruthy();
    expect(isAnalyticsRange("all")).toBe(true);
    expect(isAnalyticsRange("custom")).toBe(true);
    expect(isAnalyticsRange("90d")).toBe(false);
  });

  it("resolves a fixed window to its lookback and bucket", () => {
    const day = resolveAnalyticsWindow("7d", undefined, undefined, NOW);
    expect(day.since.toISOString()).toBe(new Date(NOW - 7 * DAY_MS).toISOString());
    expect(day.until.toISOString()).toBe(new Date(NOW).toISOString());
    expect(day.bucket).toBe("day");
    expect(day.cacheKey).toBe("7d");

    expect(resolveAnalyticsWindow("24h", undefined, undefined, NOW).bucket).toBe("hour");
  });

  it("bounds all time by Cloudflare's retention floor", () => {
    const all = resolveAnalyticsWindow("all", undefined, undefined, NOW);
    expect(all.since.toISOString()).toBe(new Date(NOW - ANALYTICS_MAX_AGE_DAYS * DAY_MS).toISOString());
    expect(all.bucket).toBe("day");
    expect(all.cacheKey).toBe("all");
  });

  it("treats the custom end date as inclusive and buckets short spans by hour", () => {
    const span = resolveAnalyticsWindow("custom", "2026-11-20", "2026-11-21", NOW);
    expect(span.since.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    // Two inclusive days → exclusive upper bound is the start of the 22nd.
    expect(span.until.toISOString()).toBe("2026-11-22T00:00:00.000Z");
    expect(span.bucket).toBe("hour");
    expect(span.cacheKey).toBe("custom:2026-11-20:2026-11-21:hour");

    expect(resolveAnalyticsWindow("custom", "2026-11-01", "2026-11-20", NOW).bucket).toBe("day");
  });

  it("clamps a custom span that ends today to now", () => {
    const span = resolveAnalyticsWindow("custom", "2026-11-18", "2026-11-24", NOW);
    expect(span.until.getTime()).toBe(NOW);
  });

  it("rejects half-filled, backwards, malformed and too-old custom spans", () => {
    expect(() => resolveAnalyticsWindow("custom", "2026-11-20", undefined, NOW)).toThrow(/both a start and an end/);
    expect(() => resolveAnalyticsWindow("custom", "2026-11-21", "2026-11-20", NOW)).toThrow(/on or after/);
    expect(() => resolveAnalyticsWindow("custom", "20/11/2026", "2026-11-21", NOW)).toThrow(/YYYY-MM-DD/);
    expect(() => resolveAnalyticsWindow("custom", "2025-01-01", "2025-01-05", NOW)).toThrow(/retains/);
  });

  it("spells a custom span out in its heading label", () => {
    expect(analyticsRangeLabel("30d")).toBe("last 30 days");
    expect(analyticsRangeLabel("all")).toBe("all time");
    expect(analyticsRangeLabel("custom", "2026-11-03", "2026-11-17")).toBe("3 Nov 2026 – 17 Nov 2026");
    expect(analyticsRangeLabel("custom")).toBe("the selected dates");
  });

  it("keeps the KPI card title short enough not to wrap", () => {
    expect(analyticsRangeShortLabel("30d")).toBe("30d");
    expect(analyticsRangeShortLabel("all")).toBe("all time");
    expect(analyticsRangeShortLabel("custom", "2026-11-03", "2026-11-17")).toBe("3 Nov – 17 Nov");
    expect(analyticsRangeShortLabel("custom")).toBe("custom");
  });
});

/** Day buckets (`resource_daily_views`) store a DATE, so the window has to be
 * resolved to IST calendar days. NOW is 12:00 UTC = 17:30 IST on 24 Nov. */
describe("analytics day bounds", () => {
  const bounds = (range: Parameters<typeof resolveAnalyticsWindow>[0], from?: string, to?: string) =>
    analyticsDayBounds(range, resolveAnalyticsWindow(range, from, to, NOW), from, to);

  it("keeps a fixed window on whole days ending today", () => {
    expect(bounds("24h")).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(bounds("7d")).toEqual({ from: "2026-11-18", to: "2026-11-24" });
    expect(bounds("30d")).toEqual({ from: "2026-10-26", to: "2026-11-24" });
  });

  it("runs all time from the retention floor to today", () => {
    expect(bounds("all")).toEqual({ from: "2026-05-28", to: "2026-11-24" });
  });

  it("keeps the picked dates of a custom span instead of rounding them out", () => {
    expect(bounds("custom", "2026-11-03", "2026-11-17")).toEqual({ from: "2026-11-03", to: "2026-11-17" });
  });

  it("clamps a custom span that ends in the future to today", () => {
    expect(bounds("custom", "2026-11-20", "2026-12-05")).toEqual({ from: "2026-11-20", to: "2026-11-24" });
  });
});

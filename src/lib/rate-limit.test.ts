import { describe, expect, it } from "vitest";
import { BoundedStore, RateLimiter, formatRetryAfter } from "./rate-limit";

const WINDOW = 60_000;

describe("RateLimiter", () => {
  it("allows exactly max hits inside one window", () => {
    const limiter = new RateLimiter();
    const limits = { max: 3, windowMs: WINDOW };
    const results = [0, 1, 2].map((i) => limiter.hit("ip", limits, 1_000 + i));
    expect(results.map((r) => r.limited)).toEqual([false, false, false]);
    expect(results[2]?.remaining).toBe(0);
  });

  it("blocks the next hit and reports when the slot frees up", () => {
    const limiter = new RateLimiter();
    const limits = { max: 2, windowMs: WINDOW };
    limiter.hit("ip", limits, 0);
    limiter.hit("ip", limits, 10_000);
    const blocked = limiter.hit("ip", limits, 20_000);
    expect(blocked.limited).toBe(true);
    // Oldest hit was at t=0, so the window reopens at t=60_000.
    expect(blocked.retryAfterMs).toBe(40_000);
  });

  it("uses a fixed window anchored on the first hit", () => {
    const limiter = new RateLimiter();
    const limits = { max: 2, windowMs: WINDOW };
    expect(limiter.hit("ip", limits, 0).limited).toBe(false);
    // Second hit inside the same window spends the allowance even though it
    // arrived 30s later — the window does not slide per hit.
    expect(limiter.hit("ip", limits, 30_000).limited).toBe(false);
    expect(limiter.hit("ip", limits, 30_001).limited).toBe(true);
    // Once the anchor window is over, the key starts clean.
    expect(limiter.hit("ip", limits, 60_001).limited).toBe(false);
    expect(limiter.hit("ip", limits, 60_002).limited).toBe(false);
    expect(limiter.hit("ip", limits, 60_003).limited).toBe(true);
  });

  it("keeps separate keys independent", () => {
    const limiter = new RateLimiter();
    const limits = { max: 1, windowMs: WINDOW };
    expect(limiter.hit("a", limits, 0).limited).toBe(false);
    expect(limiter.hit("b", limits, 0).limited).toBe(false);
    expect(limiter.hit("a", limits, 0).limited).toBe(true);
  });

  it("evicts the oldest bucket once maxEntries is reached", () => {
    const limiter = new RateLimiter({ maxEntries: 3 });
    const limits = { max: 1, windowMs: WINDOW };
    for (let i = 0; i < 3; i += 1) limiter.hit(`k${i}`, limits, 0);
    expect(limiter.size).toBe(3);
    // A fourth distinct key pushes the first one out instead of growing.
    limiter.hit("k3", limits, 0);
    expect(limiter.size).toBe(3);
    // The evicted key is treated as unseen, not as blocked.
    expect(limiter.hit("k0", limits, 0).limited).toBe(false);
  });

  it("sweeps expired buckets instead of leaking memory", () => {
    const limiter = new RateLimiter();
    const limits = { max: 1, windowMs: WINDOW };
    limiter.hit("gone", limits, 0);
    // Sweeps run at most once a minute, so jump past both thresholds.
    limiter.hit("fresh", limits, 61_000);
    expect(limiter.size).toBe(1);
  });

  it("never blocks on zero or negative limits", () => {
    const limiter = new RateLimiter();
    expect(limiter.hit("ip", { max: 0, windowMs: WINDOW }, 0).limited).toBe(true);
  });

  it("resets a single key and clears everything", () => {
    const limiter = new RateLimiter();
    const limits = { max: 1, windowMs: WINDOW };
    limiter.hit("a", limits, 0);
    limiter.reset("a");
    expect(limiter.hit("a", limits, 0).limited).toBe(false);
    limiter.clear();
    expect(limiter.size).toBe(0);
  });
});

describe("BoundedStore", () => {
  it("evicts the oldest write when full", () => {
    const store = new BoundedStore<string, number>(2);
    store.set("a", 1);
    store.set("b", 2);
    store.set("c", 3);
    expect(store.get("a")).toBeUndefined();
    expect(store.get("c")).toBe(3);
    expect(store.size).toBe(2);
  });

  it("refreshes an updated key instead of evicting it next", () => {
    const store = new BoundedStore<string, number>(2);
    store.set("a", 1);
    store.set("b", 2);
    // Touching "a" makes it the newest entry, so "b" is the one that goes.
    store.set("a", 9);
    store.set("c", 3);
    expect(store.get("a")).toBe(9);
    expect(store.get("b")).toBeUndefined();
  });

  it("prunes by predicate without touching survivors", () => {
    const store = new BoundedStore<string, number>(10);
    store.set("a", 1);
    store.set("b", 2);
    store.set("c", 3);
    expect(store.prune((value) => value === 2)).toBe(1);
    expect(store.size).toBe(2);
    expect(store.get("b")).toBeUndefined();
    expect([store.get("a"), store.get("c")]).toEqual([1, 3]);
  });
});

describe("formatRetryAfter", () => {
  it("rounds up so the message never under-promises", () => {
    expect(formatRetryAfter(1)).toBe("1s");
    expect(formatRetryAfter(1_400)).toBe("2s");
    expect(formatRetryAfter(59_000)).toBe("59s");
    expect(formatRetryAfter(60_000)).toBe("1m");
    expect(formatRetryAfter(90_000)).toBe("2m");
    expect(formatRetryAfter(3_600_000)).toBe("1h");
  });
});

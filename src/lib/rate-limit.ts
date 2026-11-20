// ---------------------------------------------------------------------
// Shared in-memory rate limiter.
//
// Every write endpoint (feedback, contributions, contact, campaign, admin
// passcode attempts) used to carry its own `Map` plus a "is this key over
// the limit?" helper. Same shape five times, and none of them ever
// removed an entry: a long-lived instance accumulates one row per IP that
// ever hit it, and a spoofed `X-Forwarded-For` can add a fresh one per
// request.
//
// This class keeps that shape but bounds it:
//   - expired buckets are swept on a timer, not only when a key is hit
//     again (a client that stops sending never comes back to reset it);
//   - the map is capped, and the oldest bucket is evicted at the cap, so
//     the ceiling is real even under a flood of distinct keys;
//   - `hit()` returns when the caller may retry, so the message the user
//     sees can say "try again in 4m" instead of "too many requests".
//
// In-memory means per instance: resets on deploy, and two instances count
// separately. That is deliberate — these are brakes on casual abuse, not
// a security boundary. Anything that must survive a restart belongs in
// Postgres, not here.
// ---------------------------------------------------------------------

export interface RateLimitRule {
  /** Maximum number of hits allowed inside one window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  /** True once the key has spent its allowance for the window. */
  limited: boolean;
  /** Milliseconds until the current window expires (0 when not limited). */
  retryAfterMs: number;
  /** Hits left in the window (never negative). */
  remaining: number;
}

interface Bucket {
  count: number;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 5_000;
const DEFAULT_SWEEP_MS = 60_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxEntries: number;
  private readonly sweepEveryMs: number;
  private lastSweep = 0;

  constructor(options: { maxEntries?: number; sweepEveryMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.sweepEveryMs = options.sweepEveryMs ?? DEFAULT_SWEEP_MS;
  }

  /** Records one hit for `key` and reports whether it is now over budget. */
  hit(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
    this.maybeSweep(now);

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      this.reserveSlot(now);
      bucket = { count: 0, expiresAt: now + rule.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const limited = bucket.count > rule.max;
    return {
      limited,
      retryAfterMs: limited ? Math.max(0, bucket.expiresAt - now) : 0,
      remaining: Math.max(0, rule.max - bucket.count),
    };
  }

  /** Drops a key's history — call after a success so a legitimate user who
   * fat-fingered a passcode twice starts clean. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }

  /** Visible for tests and for the health of a long-lived instance. */
  get size(): number {
    return this.buckets.size;
  }

  /** Removes every expired bucket. Called on a timer inside `hit()` and
   * available directly for tests. */
  prune(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweep < this.sweepEveryMs) return;
    this.lastSweep = now;
    this.prune(now);
  }

  /** Guarantees one free slot, evicting the oldest bucket at the cap.
   * Map iteration order is insertion order, so the first key is the oldest
   * entry that has not been deleted — good enough, and O(1). */
  private reserveSlot(now: number): void {
    if (this.buckets.size < this.maxEntries) return;
    this.prune(now);
    if (this.buckets.size < this.maxEntries) return;
    const oldest = this.buckets.keys().next();
    if (!oldest.done) this.buckets.delete(oldest.value);
  }
}

/**
 * A `Map` with a hard ceiling, for limiters whose bookkeeping is more than
 * a fixed window (the admin passcode lockout escalates, so it stores a
 * record rather than a count).
 *
 * Insertion order is used for eviction, so the entry dropped at the cap is
 * the one that has been in the table longest. Callers prune entries they
 * know are dead with `prune()`; the cap is the backstop for the rest.
 */
export class BoundedStore<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    return this.entries.get(key);
  }

  set(key: K, value: V): void {
    // Re-insert on update so the entry moves to the back of the insertion
    // order: a key that was just written is the *least* likely to be dead,
    // and leaving it at the front would evict it on the very next insert.
    if (this.entries.has(key)) this.entries.delete(key);
    else if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, value);
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Removes every entry the predicate calls dead; returns how many went. */
  prune(isExpired: (value: V) => boolean): number {
    let removed = 0;
    for (const [key, value] of this.entries) {
      if (isExpired(value)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

/** Formats a wait as "45s" / "4m" / "2h" for user-facing messages. */
export function formatRetryAfter(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}

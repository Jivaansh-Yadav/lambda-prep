import Fuse, { type IFuseOptions } from 'fuse.js';
import { useEffect, useMemo, useState } from 'react';

/** Fuse accepts a bare field name or a weighted `{ name, weight }` entry. */
export type FuseKey = string | { name: string; weight?: number };

const DEFAULT_OPTIONS: IFuseOptions<unknown> = {
  threshold: 0.35,
  ignoreLocation: true,
};

// Fast typing shouldn't run a full fuzzy search per keystroke: a subject's
// file list can hold 800+ items, and `fuse.search` + the resulting re-render
// are both synchronous main-thread work. 120ms is short enough that results
// still feel immediate once you pause, but collapses a burst of keystrokes
// into one search. Only the *search* is delayed — the input is bound to its
// own state, so typing stays at full speed. The per-subject file search
// (the smallest, fastest corpus) opts into a shorter 50ms debounce at its
// call site instead of this default — see FILE_SEARCH_DEBOUNCE_MS.
const DEFAULT_DEBOUNCE_MS = 120;

/** Returns `value` only after it has stopped changing for `delay` ms. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Fuzzy-filters `items` by `query` using Fuse.js, returning the full list
 * unchanged when the query is empty/whitespace.
 *
 * The query is debounced (see `debounceMs`) before it reaches `fuse.search`,
 * so a fast typist triggers one search when they pause rather than one per
 * character.
 *
 * `keys` must be referentially stable array (define it as a module-level
 * constant at the call site) — it's a dependency of the memoized Fuse
 * index, so a fresh array literal on every render would rebuild the index
 * on every render too.
 */
export function useFuseSearch<T>(
  items: readonly T[],
  keys: readonly FuseKey[],
  query: string,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
  // Per-corpus overrides. A single subject's file list wants the loose default
  // so typos still match; an index of thousands of rows needs a tighter
  // threshold or every long context string fuzzy-matches everything.
  options?: IFuseOptions<T>
): T[] {
  const fuse = useMemo(
    () => new Fuse(items as T[], { ...DEFAULT_OPTIONS, ...options, keys: keys as string[] }),
    // `options` is a module-level constant at every call site.
    [items, keys, options]
  );

  const trimmed = query.trim();
  const debouncedQuery = useDebouncedValue(trimmed, debounceMs);
  // Clearing the box should restore the full list immediately rather than
  // showing the last filtered results for another 100ms.
  const effectiveQuery = trimmed === '' ? '' : debouncedQuery;

  return useMemo(() => {
    if (!effectiveQuery) return items as T[];
    return fuse.search(effectiveQuery).map(result => result.item);
  }, [fuse, effectiveQuery, items]);
}

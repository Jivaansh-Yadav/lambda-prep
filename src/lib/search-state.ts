import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  createDefaultFilters,
  hasActiveSearchOrFilters,
  type AdvancedSearchFilters,
  type MatchMode,
  type SearchScope,
  type SortOption,
} from '@/lib/advanced-search';

/**
 * Search term / filter persistence.
 *
 * AdvancedSearchFilters lived only in React state, so a page reload, a
 * share-then-return visit, or any navigation that remounted the results page
 * put a student back at an empty search with every facet cleared (GH #12).
 *
 * Filters are mirrored into sessionStorage instead of the URL: the URL keeps
 * carrying the navigation-level params (class/subject/file) that people share,
 * while a long query and a dozen facets stay out of it. One entry per search
 * slot, keyed by route + context, so the library search and each class/subject
 * picker remember their own state and none of them leak into another.
 */

const STORAGE_PREFIX = 'lambda-prep:search:';

const MATCH_MODES: MatchMode[] = ['smart', 'exact', 'startsWith', 'regex'];
const SEARCH_SCOPES: SearchScope[] = ['all', 'filename'];
const SORT_OPTIONS: SortOption[] = ['relevance', 'name-asc', 'name-desc', 'newest', 'largest', 'smallest'];

/** Storage is shared with whatever else the user has open, and an old build may
 * have written a different shape — so every field is validated on the way in
 * and anything unexpected falls back to the default. */
export function sanitizeFilters(raw: unknown): AdvancedSearchFilters {
  const defaults = createDefaultFilters();
  if (!raw || typeof raw !== 'object') return defaults;
  const value = raw as Record<string, unknown>;

  const strings = (candidate: unknown, fallback: string[]): string[] =>
    Array.isArray(candidate) ? candidate.filter((v): v is string => typeof v === 'string') : fallback;

  const oneOf = <T extends string>(candidate: unknown, allowed: T[], fallback: T): T =>
    typeof candidate === 'string' && (allowed as string[]).includes(candidate) ? (candidate as T) : fallback;

  return {
    query: typeof value['query'] === 'string' ? value['query'] : defaults.query,
    excludeQuery: typeof value['excludeQuery'] === 'string' ? value['excludeQuery'] : defaults.excludeQuery,
    matchMode: oneOf(value['matchMode'], MATCH_MODES, defaults.matchMode),
    searchScope: oneOf(value['searchScope'], SEARCH_SCOPES, defaults.searchScope),
    fileKinds: strings(value['fileKinds'], defaults.fileKinds) as AdvancedSearchFilters['fileKinds'],
    categories: strings(value['categories'], defaults.categories) as AdvancedSearchFilters['categories'],
    years: strings(value['years'], defaults.years),
    groups: strings(value['groups'], defaults.groups),
    subjects: strings(value['subjects'], defaults.subjects),
    classSlugs: strings(value['classSlugs'], defaults.classSlugs),
    sources: strings(value['sources'], defaults.sources) as AdvancedSearchFilters['sources'],
    sortBy: oneOf(value['sortBy'], SORT_OPTIONS, defaults.sortBy),
  };
}

function storage(): Storage | null {
  // Private-mode Safari and disabled-cookie browsers throw on access.
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStoredFilters(key: string): AdvancedSearchFilters | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    return sanitizeFilters(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredFilters(key: string, filters: AdvancedSearchFilters): void {
  const store = storage();
  if (!store) return;
  try {
    if (!hasActiveSearchOrFilters(filters)) store.removeItem(STORAGE_PREFIX + key);
    else store.setItem(STORAGE_PREFIX + key, JSON.stringify(filters));
  } catch {
    // Quota exceeded — dropping the cache is harmless, the UI still works.
  }
}

/**
 * `useState` for AdvancedSearchFilters that survives remounts and reloads.
 *
 * The first render always uses defaults (the server has no storage), then an
 * effect swaps in whatever was stored. `skipSave` keeps that restore pass from
 * writing the defaults back over the very entry it is reading.
 *
 * `restore: false` opts a slot out of the restore entirely and drops any stored
 * entry for it. The library uses this when the URL carries no `q`: a bare
 * `/resources` must open untouched, not with whatever was searched last time.
 */
export function usePersistedFilters(
  key: string,
  { restore = true }: { restore?: boolean } = {},
): [AdvancedSearchFilters, Dispatch<SetStateAction<AdvancedSearchFilters>>] {
  const [filters, setFilters] = useState<AdvancedSearchFilters>(createDefaultFilters);
  const skipSaveFor = useRef<string | null>(key);

  useEffect(() => {
    if (!restore) {
      // Writing defaults removes the entry (see writeStoredFilters), so a
      // later restore attempt has nothing stale to pick up.
      writeStoredFilters(key, createDefaultFilters());
      return;
    }
    const stored = readStoredFilters(key);
    // Mark this key as "restoring" so the save effect ignores the defaults of
    // the render that triggered the read.
    skipSaveFor.current = key;
    setFilters(stored ?? createDefaultFilters());
  }, [key, restore]);

  useEffect(() => {
    if (skipSaveFor.current === key) {
      skipSaveFor.current = null;
      return;
    }
    writeStoredFilters(key, filters);
  }, [key, filters]);

  return [filters, setFilters];
}

/** True when restored filters must trigger a corpus load — the search bar only
 * asks for data on user interaction, so a restore has to request it itself. */
export function needsCorpusFor(filters: AdvancedSearchFilters): boolean {
  return hasActiveSearchOrFilters(filters);
}

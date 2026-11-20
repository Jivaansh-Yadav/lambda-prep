import { useEffect, useMemo, useState } from 'react';
import {
  computeAvailableFacets,
  createSearchFuseIndex,
  enrichSearchableFiles,
  executeAdvancedSearch,
  hasActiveSearchOrFilters,
  type AdvancedSearchFilters,
  type EnrichedSearchableFile,
  type RawSearchableFile,
  type SearchFacets,
} from '@/lib/advanced-search';

function useDebouncedString(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delayMs <= 0 || value.trim() === '') {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return value.trim() === '' ? '' : debounced;
}

export interface UseAdvancedFileSearchResult {
  enrichedItems: EnrichedSearchableFile[];
  facets: SearchFacets;
  results: EnrichedSearchableFile[];
  error: string | null;
  highlightTerms: string[];
  isActive: boolean;
}

/**
 * Memoized enrichment, facet extraction, and debounced advanced filename search
 * over a corpus of resource files.
 */
export function useAdvancedFileSearch(
  rawItems: readonly RawSearchableFile[],
  filters: AdvancedSearchFilters,
  debounceMs = 80
): UseAdvancedFileSearchResult {
  const enrichedItems = useMemo(() => enrichSearchableFiles(rawItems), [rawItems]);
  const facets = useMemo(() => computeAvailableFacets(enrichedItems), [enrichedItems]);

  const fuseIndex = useMemo(
    () => createSearchFuseIndex(enrichedItems, filters.searchScope),
    [enrichedItems, filters.searchScope]
  );

  const debouncedQuery = useDebouncedString(filters.query, debounceMs);
  const debouncedExclude = useDebouncedString(filters.excludeQuery, debounceMs);

  const effectiveFilters = useMemo<AdvancedSearchFilters>(
    () => ({
      ...filters,
      query: debouncedQuery,
      excludeQuery: debouncedExclude,
    }),
    [filters, debouncedQuery, debouncedExclude]
  );

  const isActive = hasActiveSearchOrFilters(filters);

  const output = useMemo(() => {
    if (!hasActiveSearchOrFilters(effectiveFilters)) {
      return { results: enrichedItems, error: null, highlightTerms: [] };
    }
    return executeAdvancedSearch(enrichedItems, effectiveFilters, fuseIndex);
  }, [enrichedItems, effectiveFilters, fuseIndex]);

  return {
    enrichedItems,
    facets,
    results: output.results,
    error: output.error,
    highlightTerms: output.highlightTerms,
    isActive,
  };
}

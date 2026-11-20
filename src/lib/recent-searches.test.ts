import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRecentSearches,
  loadRecentSearches,
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_STORAGE_KEY,
  removeRecentSearch,
  saveRecentSearch,
} from './recent-searches';

describe('recent-searches persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves queries in most-recent-first order and caps at 5 entries', () => {
    const queries = ['physics 2025', 'DAIS prelim', 'chemistry sqp', 'julius caesar', 'biology notes', 'maths pyq'];
    for (const q of queries) {
      saveRecentSearch(q);
    }
    const stored = loadRecentSearches();
    expect(stored).toHaveLength(MAX_RECENT_SEARCHES);
    expect(stored).toEqual(['maths pyq', 'biology notes', 'julius caesar', 'chemistry sqp', 'DAIS prelim']);
  });

  it('deduplicates queries case-insensitively and promotes re-searched queries to the top', () => {
    saveRecentSearch('DAIS Physics');
    saveRecentSearch('Chemistry SQP');
    const updated = saveRecentSearch('dais physics');
    expect(updated).toEqual(['dais physics', 'Chemistry SQP']);
    expect(loadRecentSearches()).toEqual(['dais physics', 'Chemistry SQP']);
  });

  it('ignores empty or 1-character queries', () => {
    saveRecentSearch('');
    saveRecentSearch('   ');
    saveRecentSearch('a');
    expect(loadRecentSearches()).toEqual([]);
  });

  it('removes a single query or clears all queries', () => {
    saveRecentSearch('physics 2025');
    saveRecentSearch('biology 2024');
    expect(removeRecentSearch('physics 2025')).toEqual(['biology 2024']);
    expect(loadRecentSearches()).toEqual(['biology 2024']);

    expect(clearRecentSearches()).toEqual([]);
    expect(loadRecentSearches()).toEqual([]);
  });

  it('recovers cleanly from malformed localStorage payloads', () => {
    window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, '{not-valid-json');
    expect(loadRecentSearches()).toEqual([]);
  });
});

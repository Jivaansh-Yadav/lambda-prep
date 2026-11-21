import { describe, expect, it } from 'vitest';
import { createDefaultFilters } from './advanced-search';
import {
  applyFiltersToParams,
  filtersDescribeSameUrl,
  filtersFromSearch,
  hasLibrarySearch,
  librarySearchKey,
  parseLibrarySearch,
  searchFromFilters,
} from './library-url';

describe('library URL codec', () => {
  it('keeps a plain search to one readable param', () => {
    expect(searchFromFilters({ ...createDefaultFilters(), query: 'specimen' })).toEqual({ q: 'specimen' });
  });

  it('round-trips every facet through the query string', () => {
    const filters = {
      ...createDefaultFilters(),
      query: 'prelims',
      excludeQuery: 'draft',
      matchMode: 'exact' as const,
      searchScope: 'filename' as const,
      fileKinds: ['pdf', 'docx'] as const,
      categories: ['pyq', 'notes'] as const,
      years: ['2024', '2023'],
      groups: ['PYQ Prelims · KISA & Mock Papers'],
      subjects: ['History & Civics'],
      classSlugs: ['icse-10'],
      sources: ['community'] as const,
      sortBy: 'newest' as const,
    };
    const params = new URLSearchParams();
    applyFiltersToParams(params, { ...filters, fileKinds: [...filters.fileKinds], categories: [...filters.categories], sources: [...filters.sources] });
    const parsed = parseLibrarySearch(Object.fromEntries(params));
    expect(filtersFromSearch(parsed)).toEqual({
      ...filters,
      fileKinds: [...filters.fileKinds],
      categories: [...filters.categories],
      sources: [...filters.sources],
    });
  });

  it('reads comma-separated lists and drops values it does not know', () => {
    const parsed = parseLibrarySearch({
      kind: 'pdf,exe,docx,pdf',
      cat: 'pyq,nonsense',
      sort: 'newest',
      mode: 'smart',
      scope: 'all',
    });
    expect(parsed.kind).toEqual(['pdf', 'docx']);
    expect(parsed.cat).toEqual(['pyq']);
    expect(parsed.sort).toBe('newest');
    // Defaults are not spelled out in the URL, so they are not reported back.
    expect(parsed.mode).toBeUndefined();
    expect(parsed.scope).toBeUndefined();
  });

  it('leaves unrelated params alone and clears the ones that no longer apply', () => {
    const params = new URLSearchParams('utm_source=x&kind=pdf&year=2024&file=abc');
    applyFiltersToParams(params, { ...createDefaultFilters(), query: 'notes' });
    expect(params.get('utm_source')).toBe('x');
    expect(params.get('file')).toBe('abc');
    expect(params.get('q')).toBe('notes');
    expect(params.get('kind')).toBeNull();
    expect(params.get('year')).toBeNull();
  });

  it('keeps a trailing space so a second word can be typed', () => {
    const params = new URLSearchParams();
    applyFiltersToParams(params, { ...createDefaultFilters(), query: 'sample ' });
    expect(filtersFromSearch(parseLibrarySearch(Object.fromEntries(params))).query).toBe('sample ');
  });

  it('knows when a URL is asking for something', () => {
    expect(hasLibrarySearch({})).toBe(false);
    expect(hasLibrarySearch({ kind: [] })).toBe(false);
    expect(hasLibrarySearch({ q: 'x' })).toBe(true);
    expect(hasLibrarySearch({ class: ['icse-10'] })).toBe(true);
  });

  it('compares two filter sets by the URL they describe', () => {
    const a = { ...createDefaultFilters(), query: 'lens', fileKinds: ['pdf'] as const };
    const b = { ...createDefaultFilters(), query: 'lens', fileKinds: ['pdf'] as const };
    expect(filtersDescribeSameUrl(a, { ...a, fileKinds: ['pdf'] })).toBe(true);
    expect(filtersDescribeSameUrl(b, { ...b, sortBy: 'newest' })).toBe(false);
    expect(librarySearchKey({ q: 'a', kind: ['pdf'] })).toBe('q=a&not=&mode=&scope=&kind=pdf&cat=&year=&group=&subject=&class=&src=&sort=');
  });
});

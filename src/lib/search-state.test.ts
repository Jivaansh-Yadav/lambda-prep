import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readStoredFilters,
  sanitizeFilters,
  writeStoredFilters,
} from './search-state';
import { createDefaultFilters } from './advanced-search';

/** Minimal in-memory Storage so the tests don't need a DOM. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('search-state', () => {
  beforeEach(() => {
    const store = new MemoryStorage();
    vi.stubGlobal('window', { sessionStorage: store });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns defaults when nothing is stored', () => {
    expect(readStoredFilters('library')).toBeNull();
  });

  it('round-trips active filters under their own key', () => {
    const filters = { ...createDefaultFilters(), query: 'specimen', years: ['2024'], matchMode: 'exact' as const };
    writeStoredFilters('library', filters);
    expect(readStoredFilters('library')).toEqual(filters);
    expect(readStoredFilters('class:cisce:icse-10')).toBeNull();
  });

  it('drops the entry when the filters are cleared again', () => {
    writeStoredFilters('library', { ...createDefaultFilters(), query: 'dais' });
    writeStoredFilters('library', createDefaultFilters());
    expect(readStoredFilters('library')).toBeNull();
  });

  it('ignores corrupt JSON instead of throwing', () => {
    window.sessionStorage.setItem('lambda-prep:search:library', '{not json');
    expect(readStoredFilters('library')).toBeNull();
  });

  it('sanitizes hand-edited or stale shapes field by field', () => {
    const cleaned = sanitizeFilters({
      query: 'chem',
      matchMode: 'nonsense',
      sortBy: 'oldest',
      fileKinds: ['pdf', 7, null],
      years: 'not-an-array',
    });
    expect(cleaned.query).toBe('chem');
    expect(cleaned.matchMode).toBe(createDefaultFilters().matchMode);
    expect(cleaned.sortBy).toBe(createDefaultFilters().sortBy);
    expect(cleaned.fileKinds).toEqual(['pdf']);
    expect(cleaned.years).toEqual([]);
  });
});

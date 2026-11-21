import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createDefaultFilters } from './advanced-search';
import { usePersistedFilters, writeStoredFilters } from './search-state';

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

describe('usePersistedFilters', () => {
  let store: MemoryStorage;

  beforeEach(() => {
    store = new MemoryStorage();
    vi.stubGlobal('window', { sessionStorage: store });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores the last search by default', () => {
    writeStoredFilters('library', { ...createDefaultFilters(), query: 'dais' });
    const { result } = renderHook(() => usePersistedFilters('library'));
    expect(result.current[0].query).toBe('dais');
  });

  it('opens untouched when restore is off, and drops the stale entry', () => {
    writeStoredFilters('library', { ...createDefaultFilters(), query: 'dais' });
    const { result } = renderHook(() => usePersistedFilters('library', { restore: false }));
    expect(result.current[0].query).toBe('');
    // A later mount — Back, a reload, the CTA clicked again — has nothing left
    // to replay.
    const second = renderHook(() => usePersistedFilters('library'));
    expect(second.result.current[0].query).toBe('');
  });

  it('still saves new searches made while restore is off', () => {
    const { result } = renderHook(() => usePersistedFilters('library', { restore: false }));
    act(() => result.current[1](current => ({ ...current, query: 'specimen' })));
    expect(result.current[0].query).toBe('specimen');
  });
});

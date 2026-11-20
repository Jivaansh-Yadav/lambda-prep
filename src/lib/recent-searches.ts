export const RECENT_SEARCHES_STORAGE_KEY = 'lambda-prep:recent-searches:v1';
export const RECENT_SEARCHES_EVENT = 'lambda-prep:recent-searches-updated';
export const MAX_RECENT_SEARCHES = 5;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function writeList(items: readonly string[]): void {
  if (!canUseStorage()) return;
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
    } else {
      window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(items));
    }
    window.dispatchEvent(new CustomEvent(RECENT_SEARCHES_EVENT));
  } catch {
    // Ignore storage quota or private browsing errors gracefully.
  }
}

/** Reads up to 5 persisted recent search queries from localStorage (SSR-safe). */
export function loadRecentSearches(): string[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (trimmed.length < 2) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
      if (out.length >= MAX_RECENT_SEARCHES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Persists a search query at the front of the list (deduped case-insensitively, capped at 5). */
export function saveRecentSearch(query: string, existing?: readonly string[]): string[] {
  const trimmed = query.trim();
  const base = existing ? [...existing] : loadRecentSearches();
  if (trimmed.length < 2) return base;

  const lower = trimmed.toLowerCase();
  const next = [trimmed, ...base.filter(item => item.toLowerCase() !== lower)].slice(0, MAX_RECENT_SEARCHES);
  writeList(next);
  return next;
}

/** Removes a single query from recent searches and updates localStorage. */
export function removeRecentSearch(query: string, existing?: readonly string[]): string[] {
  const base = existing ? [...existing] : loadRecentSearches();
  const lower = query.trim().toLowerCase();
  const next = base.filter(item => item.toLowerCase() !== lower);
  writeList(next);
  return next;
}

/** Clears all persisted recent searches from localStorage. */
export function clearRecentSearches(): string[] {
  writeList([]);
  return [];
}

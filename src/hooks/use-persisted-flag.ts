import { useCallback, useEffect, useState } from 'react';

/**
 * A boolean that survives reloads, backed by `localStorage`.
 *
 * The stored value is read in an effect rather than in the `useState`
 * initialiser on purpose: these pages are server-rendered, and reading
 * `localStorage` during the first render would make the client's first
 * markup disagree with the server's (a hydration mismatch) for every reader
 * who has the flag on. Applying it one tick later costs a single frame of the
 * default state and keeps SSR and hydration identical.
 *
 * Returns `[value, toggle]` — the flag is only ever flipped, never written
 * directly, so a stale closure can't desync it from storage.
 */
export function usePersistedFlag(storageKey: string, fallback = false) {
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === '1') setValue(true);
      else if (stored === '0') setValue(false);
      else setValue(fallback);
    } catch {
      // Safari in private mode (and any browser with site data disabled)
      // throws on access. The toggle still works for this session.
    }
    setLoaded(true);
  }, [storageKey, fallback]);

  useEffect(() => {
    // Skipped until the read above has run, otherwise the fallback would
    // overwrite a stored `true` before it ever gets a chance to load.
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, value ? '1' : '0');
    } catch {
      // Storage full or unavailable — nothing to recover, the flag is
      // still correct in memory.
    }
  }, [storageKey, value, loaded]);

  const toggle = useCallback(() => setValue(current => !current), []);

  return [value, toggle] as const;
}

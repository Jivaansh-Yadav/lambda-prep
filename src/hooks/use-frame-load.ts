import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';

/**
 * How long a frame may sit without firing `load` before we stop pretending
 * it is still on its way. Third-party viewers (Drive's preview, the
 * Extramarks players) boot several requests before they paint, so a few
 * seconds of white box is normal; seven is not — by then the frame is
 * usually hanging on a request that will never complete, and the reader
 * needs a way out rather than a spinner.
 */
const SLOW_AFTER_MS = 7000;

/**
 * A real viewer never finishes booting this quickly: Drive's preview pulls in
 * its whole viewer bundle, and the Extramarks players load a full activity
 * runtime. A refused navigation, on the other hand, "loads" in a fraction of
 * that — the browser commits an empty document and fires `load` anyway, which
 * is how a blocked preview used to leave a silent white box.
 */
const FAST_LOAD_MS = 400;

export interface FrameLoadOptions {
  /** How long to wait before declaring a still-blank frame broken. */
  timeoutMs?: number;
  /** Treat a load that completes almost instantly as a refused navigation.
   * Off for frames that can legitimately come straight from cache. */
  fastLoadIsSuspect?: boolean;
}

export interface FrameLoadState {
  /** True until the frame's `load` event fires. */
  isLoading: boolean;
  /** True when the frame is still blank and is unlikely to recover. */
  isSlow: boolean;
  /** Attach to the iframe's `onLoad`. */
  handleLoad: (event: SyntheticEvent<HTMLIFrameElement>) => void;
}

/**
 * A `load` event is not proof that a viewer actually rendered: when a
 * request is refused outright — an ad-blocker, a third-party-cookie rule, a
 * DNS failure — the browser still fires `load`, just on an empty
 * `about:blank` document, which is why a blocked preview used to sit there
 * as a white box with no explanation.
 *
 * Such a document is same-origin (the frame never navigated anywhere), so
 * its URL is readable; a frame that really points at drive.google.com or
 * storage.googleapis.com is cross-origin and `contentDocument` is `null`.
 */
function frameLooksEmpty(frame: HTMLIFrameElement): boolean {
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    // Refused cross-origin document: it loaded a real viewer.
    return false;
  }
  if (!doc) return false;
  const url = doc.location?.href ?? '';
  return url === '' || url === 'about:blank';
}

/**
 * Tracks one embedded frame's first paint, keyed by `resetKey` so a frame
 * that remounts for a new document starts over without an extra render pass.
 *
 * `resetKey` must change whenever the frame navigates or remounts (a new
 * Drive id, a new PDF, a fullscreen remount) — a load event from the previous
 * document must not mark the new one ready.
 */
export function useFrameLoad(
  resetKey: string,
  { timeoutMs = SLOW_AFTER_MS, fastLoadIsSuspect = true }: FrameLoadOptions = {}
): FrameLoadState {
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  // When this frame's document started loading, for the fast-load check.
  // Stamped during render rather than in an effect: the frame starts loading
  // as soon as React inserts it, and a refused navigation can fire `load`
  // before passive effects have flushed — which would make every blocked
  // frame look "slow" and push the fallback out to the timeout.
  const startedAt = useRef({ key: '', at: 0 });
  if (startedAt.current.key !== resetKey) {
    startedAt.current = { key: resetKey, at: performance.now() };
  }

  useEffect(() => {
    if (loadedKey === resetKey) return;
    const timer = setTimeout(() => setSlowKey(resetKey), timeoutMs);
    return () => clearTimeout(timer);
  }, [loadedKey, resetKey, timeoutMs]);

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLIFrameElement>) => {
      const tooFast = fastLoadIsSuspect && performance.now() - startedAt.current.at < FAST_LOAD_MS;
      if (tooFast || frameLooksEmpty(event.currentTarget)) {
        // Keep the fallback showing rather than pretending this was a paint.
        setSlowKey(resetKey);
        return;
      }
      setLoadedKey(resetKey);
      setSlowKey(null);
    },
    [resetKey, fastLoadIsSuspect]
  );

  const isLoaded = loadedKey === resetKey;
  return {
    isLoading: !isLoaded && slowKey !== resetKey,
    isSlow: !isLoaded && slowKey === resetKey,
    handleLoad,
  };
}

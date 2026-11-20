import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFrameLoad } from '@/hooks/use-frame-load';
import { usePersistedFlag } from '@/hooks/use-persisted-flag';

/** Minimal stand-in for an <iframe> whose load event we can fire by hand. */
function fakeFrame(contentDocument: Document | null) {
  return { currentTarget: { contentDocument } } as unknown as Parameters<
    ReturnType<typeof useFrameLoad>['handleLoad']
  >[0];
}

const crossOriginFrame = () => fakeFrame(null);
const blankFrame = () => fakeFrame(document.implementation.createHTMLDocument(''));

describe('useFrameLoad', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts in the loading state', () => {
    const { result } = renderHook(() => useFrameLoad('file-a'));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isSlow).toBe(false);
  });

  it('clears the skeleton once a real cross-origin viewer loads', () => {
    // A controllable clock: the frame is stamped at render, then "boots" for
    // five seconds before its load event — long enough not to be mistaken
    // for a refused navigation.
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { result } = renderHook(() => useFrameLoad('file-a'));
    clock = 5000;
    act(() => {
      result.current.handleLoad(crossOriginFrame());
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSlow).toBe(false);
  });

  it('offers the fallback when the frame loads an empty (refused) document', () => {
    const { result } = renderHook(() => useFrameLoad('file-a'));
    act(() => {
      result.current.handleLoad(blankFrame());
    });
    expect(result.current.isSlow).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('offers the fallback after the timeout if load never fires', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFrameLoad('file-a', { timeoutMs: 1000 }));
    expect(result.current.isSlow).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(result.current.isSlow).toBe(true);
  });

  it('starts over when the frame is pointed at a new document', () => {
    const { result, rerender } = renderHook(({ id }) => useFrameLoad(id), {
      initialProps: { id: 'file-a' },
    });
    act(() => {
      result.current.handleLoad(blankFrame());
    });
    expect(result.current.isSlow).toBe(true);
    rerender({ id: 'file-b' });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isSlow).toBe(false);
  });
});

describe('usePersistedFlag', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('restores a stored flag after mount', () => {
    window.localStorage.setItem('lambda-prep:test-flag', '1');
    const { result } = renderHook(() => usePersistedFlag('lambda-prep:test-flag'));
    expect(result.current[0]).toBe(true);
  });

  it('falls back to false when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedFlag('lambda-prep:test-flag'));
    expect(result.current[0]).toBe(false);
  });

  it('writes each toggle back to storage', () => {
    const { result } = renderHook(() => usePersistedFlag('lambda-prep:test-flag'));
    act(() => result.current[1]());
    expect(window.localStorage.getItem('lambda-prep:test-flag')).toBe('1');
    act(() => result.current[1]());
    expect(window.localStorage.getItem('lambda-prep:test-flag')).toBe('0');
  });

  it('never overwrites a stored true with the default on first render', () => {
    window.localStorage.setItem('lambda-prep:test-flag', '1');
    renderHook(() => usePersistedFlag('lambda-prep:test-flag'));
    expect(window.localStorage.getItem('lambda-prep:test-flag')).toBe('1');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { FrameStatus } from './frame-status';

/** FrameStatus reads its copy through `t()`, which needs the provider. */
const render = (ui: ReactElement) => rtlRender(<I18nProvider>{ui}</I18nProvider>);

const props = {
  loading: true,
  slow: false,
  openHref: 'https://drive.google.com/file/d/abc/preview',
  openLabel: 'Open in Google Drive',
};

describe('FrameStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks the load caption through its steps', () => {
    render(<FrameStatus {...props} />);
    const caption = () => document.querySelector('.frame-loading-message-text')?.textContent;
    expect(caption()).toBe('Rendering the pages');
    act(() => vi.advanceTimersByTime(1300));
    expect(caption()).toBe('Optimising the file');
    act(() => vi.advanceTimersByTime(1300));
    expect(caption()).toBe('Encrypting the resource content');
    act(() => vi.advanceTimersByTime(1300));
    expect(caption()).toBe('Polishing for your device');
    act(() => vi.advanceTimersByTime(1300));
    expect(caption()).toBe('Almost ready');
    // Wraps back to the start rather than parking on the last phrase.
    act(() => vi.advanceTimersByTime(1300));
    expect(caption()).toBe('Rendering the pages');
  });

  it('keeps one static status for screen readers instead of announcing every step', () => {
    render(<FrameStatus {...props} />);
    expect(screen.getByRole('status').textContent).toContain('Loading preview');
    expect(document.querySelector('.frame-loading-message')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the activity wording for Doxxmarks players', () => {
    render(<FrameStatus {...props} variant="activity" />);
    expect(document.querySelector('.frame-loading-message-text')?.textContent).toBe('Booting the activity');
  });

  it('renders nothing once the frame has painted', () => {
    render(<FrameStatus {...props} loading={false} />);
    expect(document.querySelector('.frame-loading')).toBeNull();
  });

  it('adds the out-of-frame link only when the frame looks stuck', () => {
    const { rerender } = render(<FrameStatus {...props} slow={false} />);
    expect(screen.queryByRole('link')).toBeNull();
    rerender(<I18nProvider><FrameStatus {...props} slow /></I18nProvider>);
    expect(screen.getByRole('link').getAttribute('href')).toBe(props.openHref);
  });
});

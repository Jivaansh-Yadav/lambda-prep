import { ExternalLink } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface FrameStatusProps {
  /** Hide the skeleton once the frame has painted. */
  loading: boolean;
  /** The frame has been blank long enough that it is probably blocked. */
  slow: boolean;
  /** Direct URL used by the escape hatch — always a plain link, so it works
   * even when the embed itself is refused. */
  openHref: string;
  /** What the link opens ("Open in Google Drive", "Open PDF in new tab"). */
  openLabel: string;
}

/**
 * The two layers that make an embedded third-party viewer feel like part of
 * the page: a document-shaped skeleton while it boots, and a plain
 * out-of-frame link when it never does.
 *
 * Both sit inside the existing frame wrapper (`position: relative`), above
 * the iframe but below the toolbar buttons, so nothing shifts when they
 * appear or disappear.
 */
export function FrameStatus({ loading, slow, openHref, openLabel }: FrameStatusProps) {
  const { t } = useI18n();

  return (
    <>
      {loading && (
        <div className="frame-loading" role="status">
          <span className="sr-only">{t('resources.watch.loadingPreview')}</span>
          <div className="frame-loading-sheet" aria-hidden="true">
            <span className="frame-loading-line is-title" />
            <span className="frame-loading-line" />
            <span className="frame-loading-line" />
            <span className="frame-loading-line is-short" />
            <span className="frame-loading-line" />
            <span className="frame-loading-line is-short" />
          </div>
        </div>
      )}
      {slow && (
        <a className="frame-fallback" href={openHref} target="_blank" rel="noreferrer">
          <ExternalLink size={13} aria-hidden="true" />
          <span>
            {t('resources.watch.notLoading')} <strong>{openLabel}</strong>
          </span>
        </a>
      )}
    </>
  );
}

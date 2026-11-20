import { useRef } from 'react';
import { Contrast, Download, ExternalLink, FileText, Maximize, Minimize } from 'lucide-react';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useFrameLoad } from '@/hooks/use-frame-load';
import { usePersistedFlag } from '@/hooks/use-persisted-flag';
import { useI18n } from '@/lib/i18n';
import { FrameStatus } from '@/components/lambda-prep/frame-status';
import { ShareWidget } from '@/components/lambda-prep/share-widget';
import type { LessonLink } from '@/lib/curriculum';
import { PDF_INVERT_STORAGE_KEY } from '@/lib/viewer-preferences';

interface NotePdfWatchProps {
  notes: LessonLink[];
  active: LessonLink;
  onSelect: (note: LessonLink) => void;
  /** Fully-qualified, directly-shareable URL for the active note (includes
   * a `?note=<index>` deep-link param — the signed PDF links themselves
   * expire, so they're never used as the share target). */
  shareUrl: string;
}

/** Revision notes are direct, signed GCS PDF URLs (refreshed weekly, valid
 * ~7 days) rather than Drive file ids, so unlike ResourceWatch this embeds
 * the PDF straight in an iframe instead of going through Drive's
 * `/file/d/<id>/preview` viewer. Most modern browsers render a PDF URL
 * natively inside an iframe without any extra viewer chrome needed. */
export function NotePdfWatch({ notes, active, onSelect, shareUrl }: NotePdfWatchProps) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(wrapRef);
  // The same preference and the same storage key as the Drive viewer, so a
  // reader who dimmed a worksheet doesn't get a white page back when they
  // open a notes PDF.
  const [inverted, toggleInverted] = usePersistedFlag(PDF_INVERT_STORAGE_KEY);
  // A signed PDF still takes a moment (and a large one longer than that) to
  // arrive, and a blocked/failed request otherwise leaves a blank panel.
  const frame = useFrameLoad(active.link);

  return (
    <div className="doxx-watch resource-watch">
      <div className="doxx-watch-main">
        <div className="doxx-sandbox-frame resource-pdf-frame" ref={wrapRef}>
          <iframe
            key={active.link}
            src={active.link}
            title={active.name}
            loading="lazy"
            onLoad={frame.handleLoad}
            className={inverted ? 'resource-pdf-inverted' : undefined}
          />
          <FrameStatus
            loading={frame.isLoading}
            slow={frame.isSlow}
            openHref={active.link}
            openLabel={t('resources.watch.openPdf')}
          />
          <div className="resource-pdf-toolbar">
            <button
              type="button"
              className={inverted ? 'doxx-sandbox-fullscreen is-active' : 'doxx-sandbox-fullscreen'}
              onClick={toggleInverted}
              aria-pressed={inverted}
              aria-label={inverted ? t('resources.watch.darkModeOff') : t('resources.watch.darkModeOn')}
              title={inverted ? t('resources.watch.darkModeOff') : t('resources.watch.darkModeOn')}
            >
              <Contrast size={16} />
            </button>
            <button type="button" className="doxx-sandbox-fullscreen" onClick={toggleFullscreen} aria-label={isFullscreen ? t('resources.watch.exitFullscreen') : t('resources.watch.fullscreen')} title={isFullscreen ? t('resources.watch.exitFullscreen') : t('resources.watch.fullscreen')}>
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
            <a className="doxx-sandbox-fullscreen" href={active.link} target="_blank" rel="noreferrer" aria-label={t('resources.watch.openPdf')} title={t('resources.watch.openPdf')}>
              <ExternalLink size={16} />
            </a>
            {/* The signed URLs are served `inline`; `download` is what asks the
                browser to save instead of open. Browsers that ignore it for a
                cross-origin link still open the PDF in a tab with its own save
                control, so the button never becomes a dead end. */}
            <a className="doxx-sandbox-fullscreen" href={active.link} download target="_blank" rel="noreferrer" aria-label={t('resources.watch.download')} title={t('resources.watch.download')}>
              <Download size={16} />
            </a>
            <ShareWidget compact url={shareUrl} title={active.name} />
          </div>
        </div>
        <h2 className="doxx-watch-title">{active.name}</h2>
      </div>

      <aside className="doxx-watch-side" aria-label={t('doxx.revisionNotes')}>
        <div className="doxx-playlist-section">
          <h3><span className="doxx-playlist-icon"><FileText size={15} /></span>{t('doxx.revisionNotes')} <span className="resource-count-badge">({notes.length})</span></h3>
          <ul className="doxx-playlist-list">
            {notes.map(note => {
              const isActive = active.link === note.link;
              return (
                <li key={note.link}>
                  <button
                    type="button"
                    className={isActive ? 'doxx-side-item is-active' : 'doxx-side-item'}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => onSelect(note)}
                  >
                    <span className="doxx-side-thumb"><FileText size={16} /></span>
                    <span className="doxx-side-name">{note.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
}

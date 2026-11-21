import { useEffect, useState } from 'react';
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
  /** What the viewer is doing while it boots. A PDF sits in a paginating
   * viewer, an Extramarks build in a game/player runtime, so the words that
   * describe the wait differ even though the wait looks identical. */
  variant?: 'document' | 'activity';
}

/** How long each step of the load message stays on screen. Five steps at this
 * pace fill the seven-second window before `useFrameLoad` gives up and swaps
 * the skeleton for the escape hatch, so the sequence ends on "Almost ready"
 * just as a healthy viewer would be painting — and a stuck one moves on to the
 * out-of-frame link instead of looping forever. */
const STEP_MS = 1300;

/**
 * The line that tells the reader something is happening behind the blank
 * frame. A frozen skeleton looks like a hung page; a caption that changes
 * ("Rendering the pages" → "Optimising the file" → …) reads as progress, so
 * people wait instead of hitting reload.
 *
 * It is decorative on purpose: `aria-hidden`, because announcing a new
 * sentence every two seconds turns a status region into a nuisance for screen
 * readers. They keep the static "Loading preview" text above it.
 */
function LoadingSteps({ steps }: { steps: string[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (steps.length < 2) return;
    const id = window.setInterval(() => setIndex(i => (i + 1) % steps.length), STEP_MS);
    return () => window.clearInterval(id);
    // Keyed on the count, not the array: the caller rebuilds the array on every
    // render, and a new identity would restart the cycle mid-step.
  }, [steps.length]);

  const step = steps[index % steps.length] ?? steps[0] ?? '';

  return (
    <span className="frame-loading-message" aria-hidden="true">
      {/* Re-keying remounts the span so the entrance animation replays on each
          new step instead of the text just snapping to the next phrase. */}
      <span key={step} className="frame-loading-message-text">{step}</span>
    </span>
  );
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
export function FrameStatus({ loading, slow, openHref, openLabel, variant = 'document' }: FrameStatusProps) {
  const { t } = useI18n();
  const steps = variant === 'activity'
    ? [
        t('resources.watch.loadingBooting'),
        t('resources.watch.loadingPlayback'),
        t('resources.watch.loadingControls'),
        t('resources.watch.loadingPolishing'),
        t('resources.watch.loadingAlmost'),
      ]
    : [
        t('resources.watch.loadingRendering'),
        t('resources.watch.loadingOptimising'),
        t('resources.watch.loadingEncrypting'),
        t('resources.watch.loadingPolishing'),
        t('resources.watch.loadingAlmost'),
      ];

  return (
    <>
      {loading && (
        <div className="frame-loading" role="status">
          <span className="sr-only">{t('resources.watch.loadingPreview')}</span>
          <div className="frame-loading-sheet" aria-hidden="true">
            <LoadingSteps steps={steps} />
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

import { Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * Cover art for one Doxxmarks material.
 *
 * Extramarks publishes a still for almost every interactive class, video, game
 * and PDF (see scripts/drive-crawl/apply-doxx-thumbnails.mjs), so a card can
 * lead with the real frame instead of a category icon. The icon still paints
 * underneath, on the category's tone, for the items whose only artwork upstream
 * is a house splash — every card keeps the same shape either way, so a row of
 * them never looks half-built.
 */
export function DoxxThumb({
  src,
  icon,
  video,
  className,
}: {
  src?: string;
  icon: ReactNode;
  /** Draws a play glyph over the still: the material is a video, not a page. */
  video?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const show = Boolean(src) && !broken;

  return (
    <span className={`doxx-thumb${show ? ' has-image' : ''}${className ? ` ${className}` : ''}`}>
      {show ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="doxx-thumb-icon">{icon}</span>
      )}
      {show && video ? (
        <span className="doxx-thumb-play" aria-hidden="true">
          <Play size={14} fill="currentColor" strokeWidth={0} />
        </span>
      ) : null}
    </span>
  );
}

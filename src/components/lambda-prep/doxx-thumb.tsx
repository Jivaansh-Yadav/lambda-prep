import { Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/** Extramarks ships one house "template" frame per content family (the digital
 * library splash, the case-study splash). Items whose only upstream artwork is
 * that splash lose it in the covers pass — four identical banners in a row read
 * worse than no art — so the frame comes back here instead, as a texture behind
 * the category icon rather than as the picture itself. Copies live in
 * `public/covers/` (640px, ~11-18 KB) so a tile never waits on a hotlink. */
const TEMPLATE_SRC = {
  /** Interactive classes, videos, practice games and revision notes. */
  library: '/covers/extramarks-template-library.jpg',
  /** Case studies (HOTS) — Extramarks' own case-study splash. */
  case: '/covers/extramarks-template-case.jpg',
} as const;

export type DoxxThumbTemplate = keyof typeof TEMPLATE_SRC;

/**
 * Cover art for one Doxxmarks material.
 *
 * Extramarks publishes a still for almost every interactive class, video, game
 * and PDF (see scripts/drive-crawl/apply-doxx-thumbnails.mjs), so a card leads
 * with the real frame. Everything else — house splash upstream, or a join the
 * crawler could not make — falls back to the category icon on the category's
 * tone, with that family's Extramarks template washed in underneath at low
 * opacity: the tile keeps its shape and its meaning, and still reads as
 * Extramarks content rather than as an empty placeholder.
 */
export function DoxxThumb({
  src,
  icon,
  video,
  template = 'library',
  className,
}: {
  src?: string;
  icon: ReactNode;
  /** Draws a play glyph over the still: the material is a video, not a page. */
  video?: boolean;
  /** Which Extramarks template shows behind the icon when there is no still. */
  template?: DoxxThumbTemplate;
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
        <>
          <img className="doxx-thumb-template" src={TEMPLATE_SRC[template]} alt="" aria-hidden="true" />
          <span className="doxx-thumb-icon">{icon}</span>
        </>
      )}
      {show && video ? (
        <span className="doxx-thumb-play" aria-hidden="true">
          <Play size={14} fill="currentColor" strokeWidth={0} />
        </span>
      ) : null}
    </span>
  );
}

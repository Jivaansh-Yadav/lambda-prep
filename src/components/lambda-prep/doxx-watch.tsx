import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video';
import { VideoPlayer } from '@videojs/react/video';
import { VideoSkin } from '@/components/videojs/video/skin';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useFrameLoad } from '@/hooks/use-frame-load';
import { useI18n } from '@/lib/i18n';
import { DoxxThumb } from '@/components/lambda-prep/doxx-thumb';
import { FrameStatus } from '@/components/lambda-prep/frame-status';
import { ShareWidget } from '@/components/lambda-prep/share-widget';
import { DOXX_CATEGORIES, categoryMeta, type DoxxCategory } from '@/lib/doxx-categories';

export interface DoxxLesson {
  name: string;
  link: string;
  /** How the lesson is played: interactive content renders in the sandboxed
   * frame, videos go through the Video.js/HLS player. Practice games, labs
   * and HOTS case studies are all interactive HTML, so they share `kind`
   * with interactive classes and are told apart by `category`. */
  kind: 'video' | 'interactive';
  category: DoxxCategory;
  /** Short badge on the card — the specific Extramarks type for activities
   * ("Virtual Lab", "Practice Game"), or a generic class/video label. */
  typeLabel: string;
  /** Extramarks still for this material: the card cover, and the video
   * player's poster frame. */
  thumb?: string;
}

interface DoxxWatchProps {
  lessons: DoxxLesson[];
  active: DoxxLesson;
  topicName: string;
  onSelect: (lesson: DoxxLesson) => void;
  /** Fully-qualified, directly-shareable URL for the active lesson (includes
   * a `?lesson=<index>` deep-link param, since lessons have no Drive id of
   * their own), used by the share popup. */
  shareUrl: string;
}

export function DoxxWatch({ lessons, active, topicName, onSelect, shareUrl }: DoxxWatchProps) {
  const { t } = useI18n();
  const activeCategory = categoryMeta(active.category);

  return (
    <div className="doxx-watch">
      <div className="doxx-watch-main">
        {active.kind === 'interactive' ? (
          <SandboxedFrame src={active.link} title={active.name} shareUrl={shareUrl} />
        ) : (
          <ContentVideoPlayer src={active.link} title={active.name} poster={active.thumb} shareUrl={shareUrl} />
        )}
        <h2 className="doxx-watch-title">{active.name}</h2>
        <p className="doxx-watch-kind">
          {t(activeCategory.labelKey)} · {active.typeLabel}
          {' · '}{topicName}
        </p>
      </div>

      <aside className="doxx-watch-side" aria-label={t('doxx.moreInTopic')}>
        {DOXX_CATEGORIES.map(cat => (
          <PlaylistSection
            key={cat.id}
            category={cat.id}
            lessons={lessons.filter(l => l.category === cat.id)}
            active={active}
            onSelect={onSelect}
          />
        ))}
      </aside>
    </div>
  );
}

function PlaylistSection({ category, lessons, active, onSelect }: { category: DoxxCategory; lessons: DoxxLesson[]; active: DoxxLesson; onSelect: (l: DoxxLesson) => void }) {
  const { t } = useI18n();
  if (!lessons.length) return null;
  const meta = categoryMeta(category);
  const Icon = meta.icon;
  return (
    <div className={`doxx-playlist-section tone-${meta.tone}`}>
      <h3><span className="doxx-playlist-icon"><Icon size={15} /></span>{t(meta.labelKey)}</h3>
      <ul className="doxx-playlist-list">
        {lessons.map(lesson => {
          const isActive = active.link === lesson.link && active.kind === lesson.kind;
          return (
            <li key={lesson.link}>
              <button
                type="button"
                className={isActive ? 'doxx-side-item is-active' : 'doxx-side-item'}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(lesson)}
              >
                <DoxxThumb
                  className="doxx-side-thumb"
                  src={lesson.thumb}
                  icon={<Icon size={16} />}
                  template={lesson.category === 'hots' ? 'case' : 'library'}
                />
                <span className="doxx-side-name">{lesson.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SandboxedFrame({ src, title, shareUrl }: { src: string; title: string; shareUrl: string }) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(wrapRef);
  // The frame remounts on a fullscreen toggle (see below), and a remount is a
  // fresh boot: the skeleton and the slow-load escape hatch start over with it.
  const frame = useFrameLoad(`${isFullscreen ? 'fullscreen' : 'inline'}|${src}`);

  return (
    <div className="doxx-sandbox-frame doxx-player-frame" ref={wrapRef}>
      <iframe
        // The Extramarks players measure the viewport once, at load, and never
        // re-lay-out on resize: growing the frame leaves the game drawing its
        // old, small stage in the corner (a "full screen" that shows the mini
        // screen). Remounting on every size change makes the player
        // initialise against the new viewport, so it fills the screen at
        // native resolution. It does restart the activity, which is why this
        // only happens on an explicit fullscreen toggle.
        key={isFullscreen ? 'fullscreen' : 'inline'}
        src={src}
        title={title}
        // allow-same-origin is required: Practice Game and 3D Interactive
        // builds fetch their own assets/workers and render a blank frame
        // without it. Every embedded source is cross-origin third-party
        // (mscontent-gcp.extramarks.com, drive.google.com), so the frame keeps
        // its own origin and still cannot reach this app's DOM, cookies or
        // storage — but never embed a same-origin link here without dropping
        // the token, because allow-scripts + allow-same-origin on the app's
        // own origin can undo the sandbox (GH issue #10).
        sandbox="allow-scripts allow-forms allow-pointer-lock allow-popups allow-same-origin"
        // The Extramarks players carry their own fullscreen button in their
        // header. Without `allow`/`allowFullScreen` the frame's Permissions
        // Policy denies `requestFullscreen` inside it, so that button is a
        // dead control that silently does nothing.
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={frame.handleLoad}
      />
      <FrameStatus
        loading={frame.isLoading}
        slow={frame.isSlow}
        openHref={src}
        openLabel={t('resources.watch.openActivity')}
        variant="activity"
      />
      <div className="resource-pdf-toolbar">
        <button
          type="button"
          className="doxx-sandbox-fullscreen"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? t('resources.watch.exitFullscreen') : t('resources.watch.fullscreen')}
          title={isFullscreen ? t('resources.watch.exitFullscreen') : t('resources.watch.fullscreen')}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
        <ShareWidget compact url={shareUrl} title={title} />
      </div>
    </div>
  );
}

function ContentVideoPlayer({ src, title, poster, shareUrl }: { src: string; title: string; poster?: string; shareUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, [src]);

  return (
    <div className="doxx-video-wrap-outer">
      <div className="doxx-video-wrap" ref={containerRef} aria-label={title}>
        {ready && (
          <VideoPlayer key={src}>
            <VideoSkin className="doxx-video-skin">
              {/* The still Extramarks publishes is the first frame of the
                  animation, so it doubles as the poster: the player no longer
                  opens on a black rectangle while the playlist resolves. */}
              <HlsJsVideo src={src} poster={poster} playsInline preload="auto" />
            </VideoSkin>
          </VideoPlayer>
        )}
      </div>
      <div className="doxx-video-toolbar">
        <ShareWidget compact url={shareUrl} title={title} />
      </div>
    </div>
  );
}

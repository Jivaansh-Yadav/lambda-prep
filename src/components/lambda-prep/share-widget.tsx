import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Mail, MessageSquareText, Share2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { DiscordIcon, RedditIcon, TelegramIcon, WhatsAppIcon } from '@/components/lambda-prep/brand-icons';
import { ShareQr } from '@/components/lambda-prep/share-qr';
import {
  ModalClose,
  ModalDescription,
  ModalRoot,
  ModalSurface,
  ModalTitle,
  ModalTrigger,
} from '@/components/lambda-prep/modal';

interface ShareWidgetProps {
  /** Fully-qualified, directly-shareable URL for this specific resource. */
  url: string;
  /** Resource name, used in pre-filled message templates and the email subject. */
  title: string;
  /** Icon-only trigger matching the surrounding CTA row (e.g. the PDF
   * viewer's fullscreen/open-in-Drive/download toolbar) instead of the
   * default labeled button. */
  compact?: boolean;
  /** Fired once per completed share action (link copied, a share target
   * opened, or the native share sheet accepted) — not on cancelled/failed
   * attempts. Used by the Resource Watch pane to track a per-file share
   * counter; omitted entirely where there's no resource to attribute the
   * share to. */
  onShare?: () => void;
}

/** Transient "Copied!" / "Link copied — paste it into Discord" hint shown
 * next to the trigger button after a share action, auto-clearing after a
 * few seconds so a later click isn't mistaken for a stale state. */
function useTransientHint(timeoutMs = 2500) {
  const [hint, setHint] = useState<{ message: string; ok: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const show = (message: string, ok: boolean) => {
    setHint({ message, ok });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setHint(null); timerRef.current = null; }, timeoutMs);
  };
  return { hint, show };
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** Share popup: opens from a CTA-row trigger, shows a copiable link and a
 * row of share targets (WhatsApp, Email, Message/SMS, Discord, Telegram,
 * Reddit), plus a "More" button that hands off to the device's native share
 * sheet when available. Every target gets the same pre-generated template
 * text so the resource is identifiable wherever it lands. */
/** One share destination. Either it is a URL we can link to directly
 * (`href`), or it needs code to run (copying the message for Discord). */
type ShareTarget = {
  key: string;
  label: string;
  icon: ReactNode;
  className: string;
  href?: string;
  /** Open in a new tab — true for http(s) targets, false for mailto:/sms:,
   * which must be handled by the OS rather than by a blank tab. */
  external?: boolean;
  onClick?: () => void;
};

/** Renders a share destination as a link when it has somewhere to go, and as
 * a button when it needs a handler. Links are preferred: `window.open` trips
 * popup blockers for mailto:/sms:, and a real anchor also gives keyboard and
 * middle-click users the behaviour they expect. */
function ShareTile({ target, onShare, children }: { target: ShareTarget; onShare: (() => void) | undefined; children: ReactNode }) {
  if (target.href) {
    return (
      <a
        className={target.className}
        href={target.href}
        {...(target.external ? { target: '_blank', rel: 'noreferrer' } : {})}
        onClick={() => onShare?.()}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={target.className} onClick={target.onClick}>
      {children}
    </button>
  );
}

export function ShareWidget({ url, title, compact = false, onShare }: ShareWidgetProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { hint, show } = useTransientHint();
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const message = t('share.messageTemplate').replace('{name}', title).replace('{url}', url);
  const emailSubject = t('share.emailSubject').replace('{name}', title);

  const handleCopy = async () => {
    const ok = await copyToClipboard(url);
    show(ok ? t('share.copied') : t('share.copyFailed'), ok);
    if (ok) onShare?.();
  };

  const handleDiscord = async () => {
    // Discord has no public web share-intent URL — the established pattern
    // is copying the link (with message) so the viewer pastes it into a
    // channel or DM themselves.
    const ok = await copyToClipboard(message);
    show(ok ? t('share.discordHint') : t('share.copyFailed'), ok);
    if (ok) onShare?.();
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title, text: message, url });
      onShare?.();
    } catch {
      // User cancelled the share sheet or it's unsupported for this
      // payload — no error state needed, the popup just stays open.
    }
  };

  // WhatsApp and Discord are the two targets the Lambda Prep community
  // actually lives on, so they get their own full-width, brand-gradient
  // tiles (with the app name) above the regular grid of smaller targets.
  const heroTargets: ShareTarget[] = [
    {
      key: 'whatsapp',
      label: t('share.whatsapp'),
      icon: <WhatsAppIcon width={30} height={30} />,
      href: `https://wa.me/?text=${encodeURIComponent(message)}`,
      external: true,
      className: 'share-hero-btn share-hero-whatsapp',
    },
    {
      key: 'discord',
      label: t('share.discord'),
      icon: <DiscordIcon width={30} height={30} />,
      onClick: handleDiscord,
      className: 'share-hero-btn share-hero-discord',
    },
  ];

  const targets: ShareTarget[] = [
    {
      key: 'telegram',
      label: t('share.telegram'),
      icon: <TelegramIcon width={26} height={26} />,
      href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
      external: true,
      className: 'share-target-btn share-target-telegram',
    },
    {
      key: 'reddit',
      label: t('share.reddit'),
      icon: <RedditIcon width={26} height={26} />,
      href: `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
      external: true,
      className: 'share-target-btn share-target-reddit',
    },
    {
      key: 'email',
      label: t('share.email'),
      icon: <Mail size={24} strokeWidth={2} />,
      // mailto:/sms: hand off to the OS handler. These must be real links:
      // window.open() on a non-http scheme is treated as a popup and silently
      // dropped by most mobile browsers (GH #10).
      href: `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(message)}`,
      className: 'share-target-btn share-target-email',
    },
    {
      key: 'message',
      label: t('share.message'),
      icon: <MessageSquareText size={24} strokeWidth={2} />,
      href: `sms:?body=${encodeURIComponent(message)}`,
      className: 'share-target-btn share-target-message',
    },
  ];

  return (
    <div className="share-widget">
      <ModalRoot open={open} onOpenChange={setOpen}>
        <ModalTrigger asChild>
          {compact ? (
            <button type="button" className="content-sandbox-fullscreen" aria-label={t('share.button')} title={t('share.button')}>
              <Share2 size={16} />
            </button>
          ) : (
            <button type="button" className="share-trigger-btn">
              <Share2 size={16} /> {t('share.button')}
            </button>
          )}
        </ModalTrigger>

        <ModalSurface
          overlayClassName="share-modal-backdrop"
          className="share-dialog"
          describedBy="share-dialog-description"
        >
            <ModalClose asChild>
              <button type="button" className="share-dialog-close" aria-label={t('nav.close')}><X size={18} /></button>
            </ModalClose>
            <ModalTitle>{t('share.title')}</ModalTitle>
            <ModalDescription id="share-dialog-description" className="share-dialog-description">{t('share.description')}</ModalDescription>

            <div className="share-link-card">
              <ShareQr url={url} title={title} />

              <div className="share-link-row">
                <input
                  className="share-link-input"
                  type="text"
                  readOnly
                  value={url}
                  aria-label={t('share.copyLink')}
                  onFocus={e => e.currentTarget.select()}
                />
                <button type="button" className="share-copy-btn" onClick={handleCopy}>
                  <Copy size={15} /> {t('share.copyLink')}
                </button>
              </div>
            </div>

            <div className="share-hero-row">
              {heroTargets.map(target => (
                <ShareTile key={target.key} target={target} onShare={onShare}>
                  <span className="share-hero-icon">{target.icon}</span>
                  <span className="share-hero-label-target">{target.label}</span>
                </ShareTile>
              ))}
            </div>

            <div className="share-targets-grid">
              {targets.map(target => (
                <ShareTile key={target.key} target={target} onShare={onShare}>
                  <span className="share-target-icon">{target.icon}</span>
                  <span className="share-target-label">{target.label}</span>
                </ShareTile>
              ))}
              {canNativeShare && (
                <button type="button" className="share-target-btn share-target-more" onClick={handleNativeShare}>
                  <span className="share-target-icon"><Share2 size={24} strokeWidth={2} /></span>
                  <span className="share-target-label">{t('share.more')}</span>
                </button>
              )}
            </div>

            <span className="share-hint" role="status" aria-live="polite">
              {hint && <>{hint.ok ? <Check size={13} /> : null} {hint.message}</>}
            </span>
        </ModalSurface>
      </ModalRoot>
    </div>
  );
}

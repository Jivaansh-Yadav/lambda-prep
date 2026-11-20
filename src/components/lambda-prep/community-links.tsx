import { DISCORD_ICSE_LABEL, DISCORD_ISC_LABEL, communityLinks } from '@/lib/lambda-prep';
import { useI18n } from '@/lib/i18n';

/**
 * The one sentence that introduces the community subreddits and Discord
 * servers. It used to be copy-pasted into the source picker, the resources hub
 * and the community page — which is how both Discord links drifted onto the
 * same invite while carrying different labels (GH #8). Links and markup now
 * live here; only the surrounding wording stays in i18n.
 *
 * `variant="desc"` is the short blurb, `variant="disclaimer"` the long one
 * with the ownership notice.
 */
export function CommunityLinks({ variant = 'desc' }: { variant?: 'desc' | 'disclaimer' }) {
  const { t } = useI18n();
  const key = variant === 'desc' ? 'resources.community.desc' : 'resources.community.disclaimer';
  const linkProps = { target: '_blank', rel: 'noreferrer' } as const;

  return (
    <>
      {t(`${key}Prefix`)}{' '}
      <a href={communityLinks.redditIcse} {...linkProps}>
        r/ICSE
      </a>{' '}
      and{' '}
      <a href={communityLinks.redditIscnerds} {...linkProps}>
        r/ISCNERDS
      </a>{' '}
      {t(`${key}Mid`)}{' '}
      <a href={communityLinks.discordIcse} {...linkProps}>
        {DISCORD_ICSE_LABEL}
      </a>{' '}
      and{' '}
      <a href={communityLinks.discordIsc} {...linkProps}>
        {DISCORD_ISC_LABEL}
      </a>{' '}
      {t(`${key}Suffix`)}
    </>
  );
}

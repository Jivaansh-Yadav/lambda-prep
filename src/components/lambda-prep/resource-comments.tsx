import { useEffect, useRef, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import {
  listResourceComments,
  submitResourceComment,
  type ResourceComment,
} from '@/lib/comments-server';
import { getVoterId } from '@/lib/voter-id';
import { formatDayLabel } from '@/lib/time-labels';

interface ResourceCommentsProps {
  fileId: string;
}

const MAX_LENGTH = 2000;
/** How many comments the thread shows before offering "Show all". */
const PREVIEW_COUNT = 3;

/** One file's thread, straight from the server. Returned as [] rather than
 * throwing so the pane below can tell "nothing said yet" from a broken page. */
async function fetchComments(fileId: string): Promise<ResourceComment[]> {
  try {
    const result = await listResourceComments({ data: { fileId } });
    return result.ok ? result.comments : [];
  } catch (error) {
    console.error('[resource-comments] failed to load comments', error);
    return [];
  }
}

/** Comments are the file's public conversation: every note written here is
 * read back by anyone opening the same file, newest first, with the composer
 * above the thread. Keeping it public is the point — a reader deciding whether
 * to trust a PDF wants what the last student said about it, not a message that
 * disappears into an admin table. */
export function ResourceCommentsControl({ fileId }: ResourceCommentsProps) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [comments, setComments] = useState<ResourceComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = (next: 'sent' | 'error', reason?: string) => {
    setStatus(next);
    setErrorReason(reason ?? null);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => {
      setStatus('idle');
      setErrorReason(null);
      statusTimerRef.current = null;
    }, 5000);
  };

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  // Reloaded after every successful post instead of splicing the new row in
  // locally: the server decides the order (created_at, then id), and the count
  // in the heading has to describe the same list the reader sees.
  useEffect(() => {
    let alive = true;
    setComments([]);
    setExpanded(false);
    setLoading(true);
    void fetchComments(fileId).then((next) => {
      if (!alive) return;
      setComments(next);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fileId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const voterId = getVoterId();
      const result = await submitResourceComment({ data: { fileId, voterId, comment: trimmed } });
      if (result.ok) {
        setValue('');
        setExpanded(true);
        showStatus('sent');
        setComments(await fetchComments(fileId));
      } else {
        showStatus('error', result.reason);
      }
    } catch (error) {
      console.error('[resource-comments] failed to submit comment', error);
      showStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  const visible = expanded ? comments : comments.slice(0, PREVIEW_COUNT);

  return (
    <section className="resource-comments" aria-labelledby={`resource-comments-heading-${fileId}`}>
      <h3 className="resource-comments-heading" id={`resource-comments-heading-${fileId}`}>
        <MessageSquareText size={14} aria-hidden="true" />
        {t('resources.comments.title')}
        {!loading && <span className="resource-comments-count">{comments.length}</span>}
      </h3>

      <form className="resource-comments-control" onSubmit={handleSubmit}>
        <label className="resource-comments-label" htmlFor={`resource-comments-input-${fileId}`}>
          {t('resources.comments.label')}
        </label>
        <textarea
          id={`resource-comments-input-${fileId}`}
          className="resource-comments-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_LENGTH))}
          placeholder={t('resources.comments.placeholder')}
          maxLength={MAX_LENGTH}
          rows={3}
          disabled={submitting}
        />
        <div className="resource-comments-footer">
          <span className="resource-comments-charcount">{value.length}/{MAX_LENGTH}</span>
          <button type="submit" className="resource-comments-submit" disabled={submitting || !value.trim()}>
            {submitting ? t('resources.comments.posting') : t('resources.comments.submit')}
          </button>
        </div>
        <span className="resource-comments-status" role="status" aria-live="polite">
          {status === 'sent' && t('resources.comments.sent')}
          {status === 'error' && (errorReason || t('resources.comments.failed'))}
        </span>
      </form>

      {loading ? (
        <p className="resource-comments-empty">{t('resources.comments.loading')}</p>
      ) : comments.length === 0 ? (
        <p className="resource-comments-empty">{t('resources.comments.none')}</p>
      ) : (
        <>
          <ul className="resource-comments-list">
            {visible.map((comment) => (
              <li key={comment.id} className="resource-comment">
                <p className="resource-comment-body">{comment.body}</p>
                <p className="resource-comment-meta">
                  <span className="resource-comment-author">{t('resources.comments.author')}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={comment.createdAt}>{formatDayLabel(comment.createdAt)}</time>
                </p>
              </li>
            ))}
          </ul>
          {comments.length > PREVIEW_COUNT && (
            <button
              type="button"
              className="resource-comments-more"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded
                ? t('resources.comments.showFewer')
                : t('resources.comments.showAll').replace('{n}', String(comments.length))}
            </button>
          )}
        </>
      )}
    </section>
  );
}

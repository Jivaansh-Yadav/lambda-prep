import { createServerFn } from "@tanstack/react-start";
import { sql } from "./db";
import { isKnownFileId } from "./resource-lookup-server";
import { RateLimiter, formatRetryAfter } from "./rate-limit";
import { clientIp, rateLimitKey } from "./client-ip";

// ---------------------------------------------------------------------
// File comments: a free-text companion to the 1-5 star rating
// (resource_ratings), shown just below it in the Resource Watch detail
// pane.
//
// Unlike a rating, a comment isn't a single "my score" value that gets
// upserted — every submission is its own row (table: resource_comments),
// so a student can leave more than one note over time. The rows are read
// back in two places: publicly, underneath the composer on the file's own
// page (newest first), and in the admin panel's Comments table, which adds
// the Drive link so an admin can jump to the file being discussed.
//
// There's no sign-in system in this app, so a comment is stored with an
// optional per-browser voter id (see voter-id.ts) purely so the same
// browser can be recognised later; it is never required, never shown to
// other readers, and never used to gate or deduplicate submissions.
// ---------------------------------------------------------------------

const MAX_COMMENT_LENGTH = 2000;

/** How many comments the public pane asks for. The panel shows the newest
 * few and expands to the rest, so this is an upper bound on one file's
 * thread, not a page size. */
const PUBLIC_COMMENT_LIMIT = 50;

// Light per-IP throttle so a single abusive client can't flood the table
// with junk rows. In-memory only (resets on deploy/restart) — same
// tradeoff as the admin passcode limiter in admin-server.ts: a brake on
// casual spam, not a hard security boundary.
const MAX_SUBMISSIONS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const commentLimiter = new RateLimiter();

export type SubmitResourceCommentResult = { ok: true } | { ok: false; reason: string };

/** Inserts one comment for a resource file. Always resolves with
 * `ok: false` (never throws) on misconfiguration, rate limiting, or a DB
 * error, so the UI can show a clear inline message instead of a crash. */
export const submitResourceComment = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown; voterId?: unknown; comment?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId) throw new Error("Missing fileId");
    if (d.voterId !== undefined && typeof d.voterId !== "string") throw new Error("Invalid voterId");
    if (typeof d?.comment !== "string") throw new Error("Missing comment");
    const trimmed = d.comment.trim();
    if (!trimmed) throw new Error("Comment cannot be empty");
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      throw new Error(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
    }
    return { fileId: d.fileId, voterId: d.voterId as string | undefined, comment: trimmed };
  })
  .handler(async ({ data }): Promise<SubmitResourceCommentResult> => {
    if (!sql) return { ok: false, reason: "Comments aren't configured." };

    const limit = commentLimiter.hit(rateLimitKey("comments"), {
      max: MAX_SUBMISSIONS,
      windowMs: WINDOW_MS,
    });
    if (limit.limited) {
      return {
        ok: false,
        reason: `Too many comments — please try again in ${formatRetryAfter(limit.retryAfterMs)}.`,
      };
    }

    // Only files that exist in the crawled catalogue can collect comments:
    // arbitrary ids create rows no reader or admin can ever resolve, and each
    // one is a free write into the table (GH issue #1).
    if (!(await isKnownFileId(data.fileId))) {
      return { ok: false, reason: "That file isn't part of the library." };
    }

    try {
      await sql.query(
        `INSERT INTO resource_comments (file_id, voter_id, body) VALUES ($1, $2, $3)`,
        [data.fileId, data.voterId ?? null, data.comment]
      );
      return { ok: true };
    } catch (error) {
      console.error("[resource-comments] failed to insert comment", error);
      return { ok: false, reason: "Could not save your comment. Try again." };
    }
  });

export type ResourceComment = {
  id: number;
  body: string;
  createdAt: string;
};

export type ListResourceCommentsResult =
  | { ok: true; comments: ResourceComment[] }
  | { ok: false; reason: string };

/** The public thread for one file, newest first. Read by every visitor, so it
 * carries no voter ids and no moderation state — just the text and when it
 * was written. An unknown file id returns an empty list rather than an error:
 * a stale link should read as "no comments yet", not as a failure. */
export const listResourceComments = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId) throw new Error("Missing fileId");
    return { fileId: d.fileId };
  })
  .handler(async ({ data }): Promise<ListResourceCommentsResult> => {
    if (!sql) return { ok: false, reason: "Comments aren't configured." };
    if (!(await isKnownFileId(data.fileId))) return { ok: true, comments: [] };

    try {
      const rows = (await sql.query(
        `SELECT id, body, created_at
         FROM resource_comments
         WHERE file_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [data.fileId, PUBLIC_COMMENT_LIMIT]
      )) as Array<{ id: string | number; body: string; created_at: string }>;

      return {
        ok: true,
        // `id` is a bigint; the driver hands it back as a string, so normalise
        // it once here instead of everywhere a key is needed.
        comments: rows.map((r) => ({ id: Number(r.id), body: r.body, createdAt: r.created_at })),
      };
    } catch (error) {
      console.error("[resource-comments] failed to load comments", error);
      return { ok: false, reason: "Could not load comments." };
    }
  });

import { createServerFn } from "@tanstack/react-start";
import { sql } from "./db";
import { isKnownFileId } from "./resource-lookup-server";
import { RateLimiter } from "./rate-limit";
import { rateLimitKey } from "./client-ip";

// ---------------------------------------------------------------------
// Resource file shares: a lean aggregate counter per file (table:
// resource_shares), incremented whenever a viewer completes a share
// action from the Resource Watch pane's ShareWidget — copying the link,
// opening a WhatsApp/Discord/Telegram/Reddit/email/SMS target, or using
// the native share sheet. Same "one counter row per file" shape as
// resource_views/resource_ratings, not a per-event log.
// ---------------------------------------------------------------------

export type ResourceShareSummary = { count: number };

// A share is a user action, not a page view: a handful per file per window is
// generous, and the per-IP cap stops one client from walking the catalogue.
const SHARE_WINDOW_MS = 10 * 60 * 1000;
const MAX_SHARES_PER_FILE = 20;
const MAX_SHARES_PER_IP = 100;
const shareLimiter = new RateLimiter();

/** Increments the share counter for a file and returns the new count.
 * Always resolves (never throws) so a DB hiccup never blocks the actual
 * share action the viewer just performed. */
export const recordResourceShare = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId.trim()) throw new Error("Missing fileId");
    const fileId = d.fileId.trim();
    if (fileId.length > 128) throw new Error("Invalid fileId");
    return { fileId };
  })
  .handler(async ({ data }): Promise<ResourceShareSummary> => {
    if (!sql) return { count: 0 };

    // A share for a file nobody can open is either a bug or an attempt to
    // inflate a counter (GH issue #1).
    if (!(await isKnownFileId(data.fileId))) return { count: 0 };

    const perFile = shareLimiter.hit(rateLimitKey("share", data.fileId), {
      max: MAX_SHARES_PER_FILE,
      windowMs: SHARE_WINDOW_MS,
    });
    const perIp = shareLimiter.hit(rateLimitKey("share-ip"), {
      max: MAX_SHARES_PER_IP,
      windowMs: SHARE_WINDOW_MS,
    });
    if (perFile.limited || perIp.limited) {
      const rows = await sql
        .query(`SELECT share_count FROM resource_shares WHERE file_id = $1`, [data.fileId])
        .catch(() => []);
      const row = (rows as Array<{ share_count: number }>)[0];
      return { count: row?.share_count ?? 0 };
    }

    try {
      const rows = await sql.query(
        `INSERT INTO resource_shares (file_id, share_count, last_shared_at)
         VALUES ($1, 1, now())
         ON CONFLICT (file_id) DO UPDATE SET share_count = resource_shares.share_count + 1, last_shared_at = now()
         RETURNING share_count`,
        [data.fileId]
      );
      const row = rows[0] as { share_count: number } | undefined;
      return { count: row?.share_count ?? 0 };
    } catch (error) {
      console.error("[resource-shares] failed to record share", error);
      return { count: 0 };
    }
  });

/** Batch share-count lookup for a set of file ids. Missing ids simply
 * have 0 shares. */
export const getResourceSharesBatch = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileIds?: unknown };
    if (!Array.isArray(d?.fileIds) || !d.fileIds.every((f) => typeof f === "string")) {
      throw new Error("Invalid fileIds");
    }
    return { fileIds: d.fileIds as string[] };
  })
  .handler(async ({ data }): Promise<Record<string, number>> => {
    if (!sql || data.fileIds.length === 0) return {};
    const rows = await sql.query(
      `SELECT file_id, share_count FROM resource_shares WHERE file_id = ANY($1)`,
      [data.fileIds]
    );
    const out: Record<string, number> = {};
    for (const row of rows as Array<{ file_id: string; share_count: number }>) {
      out[row.file_id] = row.share_count;
    }
    return out;
  });

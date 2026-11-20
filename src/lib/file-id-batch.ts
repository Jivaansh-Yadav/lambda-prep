// ---------------------------------------------------------------------
// Batch file-id validator for the public read endpoints
// (ratings, views, shares).
//
// These three took `fileIds: string[]` straight through to
// `WHERE file_id = ANY($1)`. Nothing capped the array, so a caller could
// post tens of thousands of ids (or one 500 KB id) and make Neon do real
// work for a response nobody reads — a cheap amplification for anyone
// with curl (GH issue #5).
//
// Rules: trim, drop empties, drop ids over MAX_FILE_ID_LENGTH, de-duplicate
// (the same id twice is not two rows), then cap the result at MAX_BATCH.
// De-duplicating before the cap means a padded payload can't push real ids
// out of the batch.
// ---------------------------------------------------------------------

/** Drive ids are 28-44 chars; 128 leaves room for any future id scheme. */
export const MAX_FILE_ID_LENGTH = 128;
/** Well above the largest screen's worth of files (a subject has ~100). */
export const MAX_BATCH = 200;

export function parseFileIdBatch(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid fileIds");
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") throw new Error("Invalid fileIds");
    const id = entry.trim();
    if (!id || id.length > MAX_FILE_ID_LENGTH) continue;
    seen.add(id);
    if (seen.size >= MAX_BATCH) break;
  }
  return [...seen];
}

/**
 * Human-readable file sizes.
 *
 * Lives here rather than in `advanced-search.ts` because non-search surfaces
 * (the resource viewer, the class picker) need the exact same formatting — and
 * importing it from the search module dragged Fuse.js into those bundles.
 */

/** Bytes → "812 B" / "439 KB" / "2.7 MB". Null for unknown or empty files. */
export function formatFileSize(sizeBytes: number | null): string | null {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  const mb = sizeBytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

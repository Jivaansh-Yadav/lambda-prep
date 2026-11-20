// ---------------------------------------------------------------------
// Upload and link policy for public contributions.
//
// The contribute form accepted any file up to 50 MB and forwarded the
// browser's `file.type` straight into a Drive multipart header. That left
// two holes (GH issue #2):
//   - anything could be uploaded, including .exe/.html/.svg with script in
//     it, which then sits in the reviewed-but-public Drive tree;
//   - `file.type` is caller-controlled, so a value containing CRLF could
//     inject extra MIME part headers into the multipart body.
//
// So: the extension decides the type (never the browser), the type must be
// on a short allowlist, and anything written into a header goes through
// sanitizeMimeType(). Drive links are restricted to Drive/Docs hosts so the
// queue can't be used to park phishing URLs for an admin to click.
// ---------------------------------------------------------------------

/** The formats the UI advertises, mapped to the MIME Drive should store. */
export const ALLOWED_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** `accept` attribute for the file input — keep in sync with the map above. */
export const UPLOAD_ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp";

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Resolves the upload's type from its extension. Returns null when the
 * extension isn't allowed, which callers turn into a user-facing message.
 */
export function resolveUploadType(fileName: string): { extension: string; mimeType: string } | null {
  const extension = fileExtension(fileName);
  const mimeType = ALLOWED_UPLOAD_TYPES[extension];
  return mimeType ? { extension, mimeType } : null;
}

/** Human list for error copy: "PDF, DOC, DOCX, …". */
export function allowedExtensionList(): string {
  return Object.keys(ALLOWED_UPLOAD_TYPES)
    .map((extension) => extension.toUpperCase())
    .join(", ");
}

/**
 * Makes a MIME value safe to interpolate into a header: no CR/LF, no
 * whitespace beyond the single space in `type/subtype`, and a shape check
 * against RFC 6838's token grammar. Unknown input degrades to
 * application/octet-stream rather than throwing — the upload itself
 * shouldn't fail because a browser reported an odd string.
 */
export function sanitizeMimeType(value: string | undefined | null): string {
  if (!value) return "application/octet-stream";
  const cleaned = value.replace(/[\r\n\t]/g, "").trim().toLowerCase();
  const match = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.exec(cleaned);
  return match ? cleaned : "application/octet-stream";
}

/** Hosts a contribution link may point at. */
const TRUSTED_LINK_HOSTS = ["drive.google.com", "docs.google.com"] as const;

/**
 * True for an https link on a Google Drive/Docs host. Subdomains of the
 * listed hosts are allowed (`drive.google.com` is itself already one).
 */
export function isTrustedDriveLink(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return TRUSTED_LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

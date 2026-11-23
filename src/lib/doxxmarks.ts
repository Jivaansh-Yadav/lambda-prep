// Doxxmarks is a separate site (Jivaansh-Yadav/doxxmarks, published at
// https://doxxmarks.pages.dev). Lambda Prep no longer mirrors its catalogue —
// it only links out to it, carrying enough state for the destination to open
// on the right class and enough utm tags for this site's own analytics to tell
// which button sent the visitor there.
//
// Two entry points exist, each with its own utm_medium:
//   lp        — the landing hero, the header nav, quick search and the 404 page
//   class-hub — the "Open Doxxmarks" action on a class page / subject dialog

export const DOXXMARKS_ORIGIN = "https://doxxmarks.pages.dev";

/** Where the link was clicked, recorded as utm_medium and in outbound_clicks. */
export type DoxxmarksEntry = "lp" | "class-hub";

export type DoxxmarksLinkOptions = {
  /** Lambda Prep board — ICSE or ISC. */
  board?: string | null;
  /** Lambda Prep class slug — icse-9, icse-10, isc-11, isc-12. */
  classSlug?: string | null;
  /** Optional subject name, used only where the click was already subject-scoped. */
  subject?: string | null;
};

/**
 * Doxxmarks publishes Classes XI and XII under its ICSE catalogue (its files
 * are `public/data/ICSE/XI.json` and `XII.json`), while Lambda Prep lists those
 * same two years under the ISC board. Its class slugs are built from its own
 * board name, so an ISC class has to be translated or the link lands on the
 * board chooser instead of the class.
 */
export function doxxmarksClassSlug(classSlug: string): string {
  return classSlug.startsWith("isc-") ? `icse-${classSlug.slice("isc-".length)}` : classSlug;
}

/**
 * The URL behind every Doxxmarks button.
 *
 * `?board=` and `?class=` are the destination's own query parameters (its
 * slugs are `icse-9`, `icse-11`, …); `utm_source`/`utm_medium` are ours, so a
 * click can be recognised in Doxxmarks' analytics as well as counted here.
 * Deep-linking the subject is optional: the class page is a useful landing
 * spot on its own, and a name the destination doesn't recognise simply falls
 * back to the class list.
 */
export function doxxmarksUrl(entry: DoxxmarksEntry, options: DoxxmarksLinkOptions = {}): string {
  const url = new URL(DOXXMARKS_ORIGIN + "/");
  const params = url.searchParams;

  // Every catalogue Doxxmarks publishes under board "ICSE" — including the
  // XI/XII files Lambda Prep labels ISC — so board is always ICSE here.
  params.set("board", "ICSE");
  if (options.classSlug) params.set("class", doxxmarksClassSlug(options.classSlug));
  if (options.subject) params.set("subject", options.subject);

  params.set("utm_source", "lambda-prep");
  params.set("utm_medium", entry);
  return url.toString();
}

// Bucketing of Cloudflare RUM path rows into the portal's top-level sections.
//
// Why this lives in its own module: the two numbers Cloudflare gives per path
// answer different questions, and the admin panel used to show the wrong one.
//
//   count      → every page load of that path. This is "views".
//   sum.visits → page loads that STARTED a session, i.e. loads whose referrer
//                was outside the site. An in-app navigation never produces one.
//
// Doxxmarks is mostly entered from shared links (external referrer → a visit),
// while the resource pages are mostly reached by clicking through the site
// (internal referrer → no visit). Comparing sections by `visits` therefore
// under-reported resources by construction: a real bug, not a traffic fact.
//
// The class hubs are a third section, not part of `/resources`: the home page's
// class cards go to `/classes/$classId`, which lists that class's resources and
// is where most resource browsing actually starts. Leaving it out of the
// breakdown made the library look smaller than it is.

export type SectionKey = "doxxmarks" | "resources" | "classes";

export type SectionDef = {
  key: SectionKey;
  label: string;
  /** Path prefix shown in the panel, and the value `path` on a section item. */
  prefix: string;
};

export const SECTION_DEFS: readonly SectionDef[] = [
  { key: "doxxmarks", label: "Doxxmarks", prefix: "/doxxmarks" },
  { key: "resources", label: "Resource library", prefix: "/resources" },
  { key: "classes", label: "Class hubs", prefix: "/classes" },
];

/** The `requestPath_like` allowlist for the RUM query, derived from SECTION_DEFS
 * so a new section cannot be added to the panel and forgotten in the filter. */
export const SECTION_PATH_LIKE = SECTION_DEFS.map((def) => `${def.prefix}%`);

export type PathRow = { path: string; pageViews: number; visits: number };

export type SectionBreakdownItem = {
  label: string;
  path: string;
  /** Page loads — every view of a page in this section. */
  pageViews: number;
  /** Session starts attributed to this section. Never summed with itself
   * across paths: one visit belongs to exactly one page load. */
  visits: number;
};

/** Sums the RUM rows into the panel's sections. Paths outside every section are
 * dropped rather than lumped in, because "/" and "/contribute" aren't part of
 * the comparison. */
export function buildSections(rows: readonly PathRow[]): SectionBreakdownItem[] {
  return SECTION_DEFS.map((def) => {
    let pageViews = 0;
    let visits = 0;
    for (const row of rows) {
      if (!row.path.startsWith(def.prefix)) continue;
      pageViews += row.pageViews;
      visits += row.visits;
    }
    return { label: def.label, path: def.prefix, pageViews, visits };
  });
}

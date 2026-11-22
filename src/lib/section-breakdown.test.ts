import { describe, expect, it } from "vitest";

import { SECTION_DEFS, SECTION_PATH_LIKE, buildSections } from "./section-breakdown";

describe("buildSections", () => {
  it("sums page views and visits per section, independently", () => {
    const sections = buildSections([
      { path: "/doxxmarks", pageViews: 120, visits: 90 },
      { path: "/resources", pageViews: 10, visits: 0 },
      { path: "/resources/cisce", pageViews: 40, visits: 2 },
      { path: "/resources/community", pageViews: 30, visits: 1 },
      { path: "/classes/icse-10", pageViews: 400, visits: 12 },
      { path: "/classes/isc-12", pageViews: 100, visits: 3 },
    ]);

    expect(sections).toEqual([
      { label: "Doxxmarks", path: "/doxxmarks", pageViews: 120, visits: 90 },
      { label: "Resource library", path: "/resources", pageViews: 80, visits: 3 },
      { label: "Class hubs", path: "/classes", pageViews: 500, visits: 15 },
    ]);
  });

  it("keeps resources ahead of doxxmarks when measured in page views but behind in visits", () => {
    // The exact shape of the bug this replaces: section totals compared by
    // `visits` made the library look smaller than Doxxmarks even though it was
    // being viewed more, because its loads come from inside the site.
    const sections = buildSections([
      { path: "/doxxmarks", pageViews: 50, visits: 45 },
      { path: "/resources/cisce", pageViews: 300, visits: 4 },
    ]);
    const [doxx, resources] = sections;

    expect(resources!.pageViews).toBeGreaterThan(doxx!.pageViews);
    expect(resources!.visits).toBeLessThan(doxx!.visits);
  });

  it("ignores paths that belong to no section", () => {
    const sections = buildSections([
      { path: "/", pageViews: 999, visits: 999 },
      { path: "/contribute", pageViews: 50, visits: 10 },
      { path: "/admin", pageViews: 5, visits: 1 },
    ]);

    for (const section of sections) {
      expect(section.pageViews).toBe(0);
      expect(section.visits).toBe(0);
    }
  });

  it("returns one zeroed row per known section so the chart never loses a bar", () => {
    const sections = buildSections([]);
    expect(sections.map((s) => s.label)).toEqual(SECTION_DEFS.map((def) => def.label));
    for (const section of sections) expect(section.pageViews).toBe(0);
  });

  it("derives the query allowlist from the same definitions", () => {
    expect(SECTION_PATH_LIKE).toEqual(SECTION_DEFS.map((def) => `${def.prefix}%`));
    expect(SECTION_PATH_LIKE).toContain("/classes%");
  });
});

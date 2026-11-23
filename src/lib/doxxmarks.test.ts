import { describe, expect, it } from "vitest";

import { DOXXMARKS_ORIGIN, doxxmarksClassSlug, doxxmarksUrl } from "./doxxmarks";

describe("doxxmarksClassSlug", () => {
  it("keeps ICSE slugs as they are", () => {
    expect(doxxmarksClassSlug("icse-9")).toBe("icse-9");
    expect(doxxmarksClassSlug("icse-10")).toBe("icse-10");
  });

  it("translates ISC XI/XII to the slugs Doxxmarks actually publishes", () => {
    // Doxxmarks labels every class ICSE in its catalogue (public/data/ICSE/XI.json),
    // so `isc-11` is not a class it knows and would land on the board chooser.
    expect(doxxmarksClassSlug("isc-11")).toBe("icse-11");
    expect(doxxmarksClassSlug("isc-12")).toBe("icse-12");
  });
});

describe("doxxmarksUrl", () => {
  it("opens the ICSE class list for the site-wide entry point", () => {
    const url = new URL(doxxmarksUrl("lp", { board: "ICSE" }));
    expect(url.origin).toBe(DOXXMARKS_ORIGIN);
    expect(url.searchParams.get("board")).toBe("ICSE");
    expect(url.searchParams.get("class")).toBeNull();
    expect(url.searchParams.get("utm_source")).toBe("lambda-prep");
    expect(url.searchParams.get("utm_medium")).toBe("lp");
  });

  it("carries board and class for a class-hub click", () => {
    const url = new URL(doxxmarksUrl("class-hub", { board: "ICSE", classSlug: "icse-10" }));
    expect(url.searchParams.get("board")).toBe("ICSE");
    expect(url.searchParams.get("class")).toBe("icse-10");
    expect(url.searchParams.get("utm_medium")).toBe("class-hub");
  });

  it("translates an ISC class and keeps the subject when one is given", () => {
    const url = new URL(
      doxxmarksUrl("class-hub", { board: "ISC", classSlug: "isc-11", subject: "Computer Science" }),
    );
    expect(url.searchParams.get("board")).toBe("ICSE");
    expect(url.searchParams.get("class")).toBe("icse-11");
    expect(url.searchParams.get("subject")).toBe("Computer Science");
  });

  it("always tags lambda-prep as the source, whatever the entry point", () => {
    for (const entry of ["lp", "class-hub"] as const) {
      const url = new URL(doxxmarksUrl(entry));
      expect(url.searchParams.get("utm_source")).toBe("lambda-prep");
      expect(url.searchParams.get("utm_medium")).toBe(entry);
    }
  });
});

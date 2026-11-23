import { recordOutboundClick } from "./outbound-server";
import type { DoxxmarksEntry } from "./doxxmarks";

// ---------------------------------------------------------------------
// Client half of outbound-click attribution (server half: outbound-server.ts).
//
// A click that opens another site in a new tab never appears in this site's
// page views, so the click itself has to be reported. One session contributes
// at most one row per entry point: the marker lives in sessionStorage, which
// survives reloads but not a new tab/browser session. That makes COUNT(*) read
// as "visitors sent there", not "times a button was tapped".
// ---------------------------------------------------------------------

const SESSION_KEY_PREFIX = "lp-outbound:";

export type DoxxmarksClickContext = {
  board?: string | null;
  classSlug?: string | null;
  subject?: string | null;
};

/** Records one Doxxmarks click, at most once per session per entry point.
 * Safe to call from an onClick handler: it never throws and never blocks the
 * navigation, which is already under way in the new tab. */
export function recordDoxxmarksClick(entry: DoxxmarksEntry, context: DoxxmarksClickContext = {}): void {
  if (typeof window === "undefined") return;

  const key = `${SESSION_KEY_PREFIX}doxxmarks:${entry}:${context.classSlug ?? "-"}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Private mode / storage disabled: record it anyway rather than losing the
    // click. The per-IP brake on the server is the real backstop.
  }

  void recordOutboundClick({
    data: {
      destination: "doxxmarks",
      entry,
      board: context.board ?? null,
      classSlug: context.classSlug ?? null,
      subject: context.subject ?? null,
      path: window.location.pathname,
    },
  }).catch((error) => {
    // Never let attribution break the page; the row simply doesn't exist.
    console.error("[outbound] could not record click", error);
  });
}

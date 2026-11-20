# Resource Search

`/resources` is a **filename search over every file in both collections** — Community and CISCE, all four classes — not a class browser. The two browsable catalogues live at `/resources/community` and `/resources/cisce` and are reached from a result card, from the two collection cards on the idle page, or from a class page.

The corpus is every `ResourceItem` in both sources for every class: **7,668 files** at the time of writing (`src/data/resource-counts.json` → `grandTotal`). Treat that number as derived, never hard-code it in UI copy.

## URL contract

| URL | Meaning |
| --- | --- |
| `/resources` | Idle: seed queries plus the two collection cards |
| `/resources?q=phy+2024` | The same page with a live query |
| `/resources/community?class=icse-10&subject=Physics&file=<id>` | Community browser, opened on one file |
| `/resources/cisce?class=isc-11&subject=…&stream=…&file=<id>` | CISCE browser, same shape |

`q` is written with `history.replaceState`, never with a router navigation, so typing does not push a history entry per keystroke. This is deliberate:

- the query survives the trip into a file view — pressing Back returns to the same result list instead of an empty library page;
- a search is shareable by copying the address bar;
- opening `/resources?q=…` hydrates the box on mount and starts the corpus load immediately.

Only `q` is read from the URL. Every structured filter (class, subject, year, kind, category, group, source) is component state and is **not** shareable yet — if you make one shareable, add it to the same hydration effect rather than to the route's `validateSearch`, because `/resources` renders before the corpus exists and must not remount when the corpus arrives.

## Query syntax

Parsed by `parseSmartQuery()` in `src/lib/advanced-search.ts`; the same parse feeds highlighting, so what matches is what gets marked.

| You type | It means |
| --- | --- |
| `phy 2024` | All terms must appear (AND), in any order, anywhere in the searched text |
| `"board paper"` | That exact phrase |
| `-solution` / `!solution` | Exclude files containing it (`-"answer key"` works too) |
| `pyq OR prelim` / `pyq \| prelim` | Either term |
| `2024\|2025` | Either value of one term |
| `*spec*` | Wildcard — `*` is any run of characters, `?` is one character |
| `/^\d{2}-\d{2}.*specimen/i` | In `regex` mode: `/pattern/flags` shorthand, or a bare pattern (always case-insensitive) |

Excluded terms are also collected from the panel's **Exclude words** box, split on commas/whitespace.

### Synonyms

`SYNONYM_GROUPS` expands student shorthand before matching, so `phy prelim sol` finds `Physics_Preboard_Solution.pdf`. Current groups: subject shorthands (`phy`/`chem`/`bio`/`math(s)`/`eng`/`lit`/`hist`/`civ`/`geo`/`comp`/`eco`/`acc`/`comm`), plus document vocabulary — `sol`/`ans`/`key`/`marking scheme`, `prelim`/`preboard`/`mock`/`terminal`, `sqp`/`specimen`/`sample`/`model`, `pyq`/`past paper`/`previous year`/`main examination`, `cfq`/`competency`/`hots`/`question bank`, `apf`/`analysis`/`pupil performance`, `imp`, `rev`/`revision`/`notes`, `syl`/`syllabus`/`scope`.

Adding a word here is the cheapest way to make a real filename pattern findable. Add it to the group it belongs to; never create a one-element group.

## Match modes

| Mode | Behaviour |
| --- | --- |
| `smart` (default) | Tokenised AND with synonyms, wildcards and exclusion |
| `exact` | The whole query as one literal phrase; the filename is checked first, the folder trail only when the scope is `all` |
| `startsWith` | The **filename** must begin with the query (`22-23 …`) — folders are not considered |
| `regex` | Raw `RegExp`; an invalid pattern is reported in the bar instead of thrown |

`regex` is the only mode that can fail at runtime — `executeAdvancedSearch()` returns the message through `error` and the bar renders it in `.adv-search-error` with `role="alert"`. Never let it reach an error boundary.

## Scope

- **Filename + folders** (`all`) — filename, the folder trail (chapter/type folders), the subject and the display group.
- **Filename only** — the filename, nothing else.

## Facets

Source (`community`/`cisce`), class, subject, year, file kind, resource category (Prelims, PYQs, Sample/SQP, Solutions, Notes, CFQs, Syllabus) and group (folder-derived; `general` is displayed as Editor's Choice).

Counts come from `computeAvailableFacets()` over the **whole corpus**, not over the current result set — they answer "how much is there", not "how much is left". Keep that behaviour: narrowing counts per query makes the facets flicker to zero and hides the fact that a filter, not the corpus, is what excluded a file.

Facets with zero files are dropped from the list rather than shown disabled.

## Sorting

`Best match` (relevance, the default), `Filename (A–Z)`, `Filename (Z–A)`, `Newest year first`, `Largest file first`, `Smallest file first`.

Two of them have an explicit "unknown" rule, because a missing value must not silently rank as zero:

- **Newest year first** orders by extracted year, then Drive's modified time, then filename. Files with no year sort last rather than first.
- **Largest / Smallest** push files with no recorded size to the end in *both* directions — an unknown size is never "0 bytes".

Name sorts use `localeCompare(..., { numeric: true })`, so `2`, `10` and `22-23` order the way a student expects instead of lexically.

## How a result is produced

1. `loadAllLibraryFiles(classSlugs)` fetches both sources for all classes, once, and memoises the result in a module-level cache. It is called on the first keystroke (`onActivateCorpus`), not on mount — the idle page must not download the whole catalogue.
2. `enrichSearchableFiles()` precomputes, per file: lowercase name, separator-normalised tokens, folder trail, display group, file kind, categories, years, size and timestamp. This is the expensive pass and runs once per corpus.
3. `computeAvailableFacets()` derives the facet lists from the enriched corpus.
4. `useAdvancedFileSearch(corpus, filters, 120)` debounces the query by 120 ms, then `executeAdvancedSearch()` applies the facets, scores the query against that pool and sorts. In `smart` mode scoring is a cheap substring pass over precomputed lowercase text; **Fuse.js is only a fallback** for when nothing matched, which is what buys typo tolerance (`physiks prelm` → `Physics_Prelim`) without letting fuzzy noise into every result list.
5. Results render as cards; above **60** hits the grid switches to `windowScroll` virtualisation (see below).

## Performance rules

- `VirtualFileGrid` has two modes. Below the threshold it renders a plain grid; above it, `useWindowVirtualizer` with a measured `scrollMargin` scrolls with the page. A nested 600 px scroller was the old behaviour and it hid up to 60,000 px of content behind a wheel trap.
- Both virtualiser hooks are always called, with a count of 0 for the inactive one — conditionally calling a hook here breaks the render order when a search crosses 60 hits.
- Search rows are a fixed 174 px: the filename is clamped to two lines. Do not let a card grow with its metadata; ragged rows break `measureElement`-free row estimates.
- The corpus cache is per module instance. Anything that changes a dataset at runtime must invalidate it.

## Responsive behaviour

- Below **900 px** the filter panel becomes a modal bottom sheet (`role="dialog"`, backdrop, pinned header, footer with Reset and "Show N files"). The sticky toolbar must not be `position: sticky` while it is open — a sticky ancestor with `backdrop-filter` creates a containing block, which pins the fixed sheet to the wrong viewport offset. `.adv-sticky:has(.adv-filter-panel)` is what keeps this honest.
- Below **640 px** the toolbar collapses to one swipeable row of category chips, the seed-query block and the per-chip counts are hidden, and the live count moves into the controls row so the summary line can disappear once the bar sticks.
- The quick-filter chips collapse entirely when the bar is stuck, taking the pinned bar from ~183 px to ~127 px.

## Keyboard and screen readers

`/` focuses the search box, ArrowDown opens and walks the recent-search listbox, Enter selects, Escape dismisses. Chips are `aria-pressed` buttons; the results summary is `aria-live="polite"`; the mobile sheet traps nothing but returns focus to the Filters button on close and locks body scroll while open.

Recent searches live in `localStorage` under `lambda-prep:recent-searches:v1` (max 5) and broadcast `lambda-prep:recent-searches-updated` so every mounted bar stays in sync.

## Code map

| Piece | File |
| --- | --- |
| Query parsing, scoring, facets, highlighting | `src/lib/advanced-search.ts` |
| Debounce + memoised pipeline | `src/hooks/use-advanced-file-search.ts` |
| Toolbar, filter panel, mobile sheet, recents | `src/components/lambda-prep/advanced-search-bar.tsx` |
| Search page, result cards, URL sync, sticky observer | `src/routes/resources.index.tsx` |
| Recents persistence | `src/lib/recent-searches.ts` |
| Cross-class corpus | `loadAllLibraryFiles()` in `src/lib/resources-data.ts` |

Tests: `advanced-search.test.ts` (parsing, scoring, facets, highlighting) and `recent-searches.test.ts` (storage round-trip, dedupe, cap). Both are pure — no DOM — so they run in the normal `bun run test`.

## Invariants

- `advanced-search.ts` stays pure and synchronous. No `fetch`, no `window`, no React. Everything testable lives there; the hook and the component only orchestrate.
- A new resource category needs three edits: `RESOURCE_CATEGORIES`, `detectCategories()` and the labels map. A category that exists only in a component is a bug.
- A new facet needs the field in `AdvancedSearchFilters`, `createDefaultFilters()`, `countActiveStructuredFilters()`, `computeAvailableFacets()` and a section in the panel. `hasActiveSearchOrFilters()` decides whether the page shows results or the idle state — forgetting it there makes the filter silently do nothing.
- Highlighting is derived from the parse, so a new syntax token must be added to `getHighlightSegments()` in the same change.

## Verifying a change

```bash
bunx tsc --noEmit
bun run test
bun run dev   # then: /resources, /resources?q=specimen, a 60+ hit query, and a 390px viewport
```

Check all four: the idle page, a small result set, a result set above 60 (scroll to the bottom — the last row must be reachable), and the filter sheet at 390 px wide.

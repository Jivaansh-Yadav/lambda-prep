# Admin and analytics

`/admin` is a passcode-gated dashboard. It is deliberately not a CMS: content still comes from Drive, and the dashboard exists to *watch* the machine, not to author content.

## The gate

- The passcode is verified server-side by `requirePasscode()` in `src/lib/admin-server.ts`; the client never holds a hash.
- The verified passcode lives **in memory** for the session. Navigating to `/admin` with a full page load therefore logs you out; client-side navigation keeps you in. This is intentional — a passcode in `localStorage` would survive a shared machine.
- Every admin server function re-checks the passcode. The route guard is convenience; the server function is the boundary.
- `/admin` is `noindex, nofollow` and has its own title. It must never appear in the sitemap.
- Section pages are reachable by URL before unlocking (`/admin?section=analytics` is what the dashboard cards link to). A data fetch that needs the passcode therefore waits for it instead of firing with an empty string — otherwise the first render would ask the server for analytics with no credentials and the panel would report the rejection as a configuration problem.

## The dashboard

Two rows, four cards each, colour-coded by intent.

**Analytics (read-only, cool accents)**

| Card | Content |
| --- | --- |
| Page loads | Cloudflare Web Analytics page loads for the selected range |
| Visits | Unique visits for the range |
| Latest commit | `owner/repo@sha` short message — proves what production is running |
| Deep analytics | Drill-down: traffic chart, section table, RUM detail panel |

**Manage (actionable, warm accents)**

| Card | Content |
| --- | --- |
| Manage resources | Drive folder attachment, the dataset workflow panel, the Drive root link |
| Resource stats | Which files were rated, viewed, shared or discussed in the selected range |
| Contributed resources | Student submissions with approve / reject / notes |
| Contact messages | Footer messages with status and admin notes |

Each card opens a full-width section (`?section=manage|stats|contributions|messages|analytics`) rather than a modal, so a long table is scrollable on a phone and the URL is shareable.

## Analytics pipeline

Two different sources, both cached in Postgres because neither API is fast enough to call on every dashboard load:

| Source | Table | What it gives |
| --- | --- | --- |
| Cloudflare **GraphQL** analytics | `cloudflare_analytics_cache` | page loads, visits, page views and visits per section |
| Cloudflare **Web Analytics (RUM)** | `cloudflare_rum_cache` | real-user visits, referrers, a fuller traffic chart |

- **24h is the default window everywhere** (`ADMIN_DEFAULT_RANGE` in `admin-ranges.ts`): the dashboard answers "what is happening now", and a 30-day default made every number read as background noise. The list, labels and window maths live in that one module so the client selector and the server queries cannot drift.
- Cache keys include the **range** (`24h`, `7d`, `14d`, `30d`), so switching ranges does not overwrite the other three.
- A cached row is served only while it is under five minutes old. **Refresh always fetches live**: the server deletes that range's cached row first (`deleteCache` / `deleteRumCache` in `admin-server.ts`), so an explicit refresh is never answered with a snapshot. Switching ranges may still use a fresh row — that is navigation, not a refresh.
- **Every range is fetched in ≤7-day slices** (`rum-windows.ts`), oldest first, summed per bucket. Cloudflare's `*AdaptiveGroups` datasets downsample a whole query once it gets wider than about a week: the same two days reported 339 page loads when asked as part of a 7-day window and 230 — with one quiet day dropped entirely — when asked as part of a 30-day window. That is why 14d/30d used to look stale and disagree with 7d. A 24h window is a single slice, so nothing changes there; 30d makes five Cloudflare calls instead of one.
- Credentials live in `cloudflare_integration` (Cloudflare account id + a RUM API token with `Account → Analytics → Read`) — seeded once by hand in Neon, not in env vars.
- Queries filter on **request hostname**, not on a Web Analytics site tag. The host comes from `SITE_URL` (`TRACKED_HOST` in `admin-server.ts`), so the panel, the sitemap and the canonical link all follow one value. A site tag is bound to the hostname its Web Analytics site was created for, and a stale one silently reports zero — which is exactly how the panel once went empty after production moved to `lambda-prep.pages.dev`.
- The account can hold unrelated Web Analytics sites (other Pages projects, other people's sites). Every query — chart, KPIs, section table and the whole RUM panel — filters to that one hostname, so those sites never enter the totals or the tables. The chart footer prints the counted host so it is never ambiguous which site a number belongs to.
- Top referrers is the only place another domain can surface, and only as *where a lambda-prep visit came from*; `(unknown)` is a direct visit.
- `bot: 0` is applied to every query so the numbers reconcile with Cloudflare's own dashboard cards, which exclude bots.
- When nothing is configured, the panel says so and prints the exact steps to fix it, instead of showing zeroes that look like an outage.
- Chart axes, tooltips, table cells and the "Live / Cached" stamp all run on **one clock, IST**, and the chart says so under the axis. Every label anywhere in the app goes through `src/lib/time-labels.ts` (`SITE_TIMEZONE = 'Asia/Kolkata'`); no component calls `toLocaleDateString` / `toLocaleTimeString` on a timestamp. Before that module, three clocks coexisted: chart buckets were pinned to UTC, table cells used the viewer's zone, and Drive dates used the browser default, so the same view read `2:14 PM` in one row and `12:14` in a chart tick for one admin and something else for another. Day-only values were worse — `2026-11-12` parses as UTC midnight and rendered as the 11th west of Greenwich.
- **Hourly ticks print minutes**, `5:30 PM` rather than `5 PM`. Cloudflare's buckets start on the UTC hour, and IST is UTC+5:30, so a bucket boundary lands on `:30` IST every time; rounding to the hour would have put a label half a bucket away from the bar it sits under. The chart caption explains the offset instead of hiding it.
- Absolute moments carry the suffix (`Nov 18, 2026, 2:14 PM IST`), day labels stay `Nov 18`, and any unparseable value renders `—` rather than `Invalid Date`.
- The **RUM beacon is injected by the app**, not by Pages: `__root.tsx` renders `beacon.min.js` with the site tag resolved in `cf-beacon.ts` — `VITE_CF_BEACON_TOKEN` when the build environment sets one, the public production tag otherwise, and nothing at all in a development build. Pages only auto-injects for the Pages project's own hostname while real visitors also arrive through the Eazo aliases, so the beacon has to be ours. The default exists because requiring the variable meant a deploy without it shipped **no beacon at all**, and nothing in the panel said so: see "When the numbers disagree" below.
- **Compare sections by page views, not visits.** Cloudflare's `count` is every page load of a path; `sum { visits }` only counts the load that *started* a session (referrer outside the site). Resource pages are mostly reached by clicking through the site, so the old "visits by section" chart under-reported them by construction — it was a bug in the metric, not in the traffic. The card prints page views (`count`) with visits beside them in a table.

- **No bar chart for the two sections.** A vertical bar chart drew two bars (Class hubs, Resource library) and spent most of a screen doing it; the table says the same thing in two rows, so the chart was removed. The section rows, the RUM path allowlist and `buildSections` are unchanged — only the drawing went.
- The breakdown has **two sections**, defined in `section-breakdown.ts` and used both for the panel and for the RUM query's path allowlist, so they cannot drift: `/resources` (the library) and `/classes` (**Class hubs** — the home page's class cards land there and each hub lists that class's resources, so it is a resource surface even though its path does not start with `/resources`). Leaving the class hubs out is what made the library look smaller than it is.
- A cached payload written before the `pageViews` field existed is treated as a miss (`isCurrentPayload`), so a deploy never leaves five minutes of empty table rows behind.

### Sorting the panel

The Resource stats tabs have always sorted on click; the analytics panel did not, so one half of the admin responded to a header and the other half ignored it. Every table in Deep analytics now behaves like the stats tables:

- **Section breakdown** — Section / Page views / Visits, opening on page views descending, because that is the number the footnote under the table tells you to compare sections by.
- **Campaign sources** — Source / Medium / Campaign / Sessions / Last seen, opening on last seen newest-first: the point of the list is which link moved recently.
- **Doxxmarks exits** — From / Board / Class / Subject / Visitors / Last click, same default.
- A text column lands on **A→Z** the first time it is clicked, a count or a timestamp on **descending**. `useSortState(key, { textKeys })` carries that rule, so "Board" does not open at Z→A. Comparators stay in `src/lib/table-sort.ts`: nulls sink in both directions, numbers compare numerically.
- The five RUM lists arrive ranked by visits from Cloudflare. One **Most visits / A–Z** switch in the card header re-orders all five together — five separate controls inside a five-column grid would cost more room than the lists themselves.

### Campaign sources — the third source

Cloudflare cannot say which *link* a visit came from. Reddit, Discord, Slack and Gmail strip the `Referer`, and the RUM dataset drops query strings entirely, so `?utm_source=reddit` never reaches it. The "Campaign sources" card in Deep analytics therefore reads the app's own table instead:

- The browser reads `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `utm_term` from the landing URL (`campaign-tracking.ts`, called once from `RootComponent`). `?ref=` is accepted as a shorthand for `utm_source`, which is what short links typed by hand usually use.
- One row per session per distinct set of tags (`sessionStorage` guard), so reloads and internal navigation never inflate the count. The number in the table is **sessions that arrived from that link**.
- Values are normalised again on the server and the write is rate limited per IP, same as the other public counters.
- The card is host- and range-scoped like the rest of the panel, and prints the recorded total all-time when the selected range is quieter.
- Because this is the app's own data, it keeps working regardless of what Cloudflare collects — it is also the only attribution that survives a stripped referrer.

Share links look like `https://lambda-prep.pages.dev/?utm_source=reddit&utm_medium=post&utm_campaign=class10`.

### Doxxmarks exits — what the hand-off sends, and where it went

Lesson videos live on `doxxmarks.pages.dev`, so the panel also answers "how many students did we send there?".

- Every link is built in one module (`src/lib/doxxmarks.ts`), which sets the board, the class slug and — from the subject dialog — the subject, then tags the URL `utm_source=lambda-prep` with `utm_medium` naming the entry point: **`lp`** for site chrome (hero, header nav, quick search, the 404 page) and **`class-hub`** for the class header button and the subject dialog. Doxxmarks' own analytics can therefore split site-wide traffic from class-level traffic.
- ISC 11/12 are sent as `board=ICSE&class=icse-11|icse-12`, because that is how Doxxmarks publishes those classes; without the translation the link lands on its board chooser.
- Clicking calls `recordOutboundClick` (`src/lib/outbound-server.ts`), which writes one row to `outbound_clicks` with destination, entry, board, class slug, subject, the path the student clicked from, and `cf-ipcountry`. The browser side (`outbound-tracking.ts`) guards with `sessionStorage`, so a student who clicks the same entry point twice in one session is counted once; the server re-normalises the values and rate limits per IP regardless.
- The write is fire-and-forget: a failed insert never blocks or delays the navigation to Doxxmarks.
- The **Sent to Doxxmarks** card groups the table by entry / board / class / subject and prints visitors plus the last click, in IST, for the selected range — with the all-time total underneath, because a quiet range would otherwise read as "nobody uses it".

### When the numbers disagree

The two sources measure different things on purpose, so a mismatch is a signal, not noise — and one mismatch has already happened once.

- **Campaign sessions > Cloudflare page loads** is the diagnostic that matters. A campaign row exists only if the browser ran this app's JavaScript on a landing page, so every recorded arrival is also a page load Cloudflare should have seen. When the panel counted 97 arrivals in 24h while Cloudflare reported 4 page loads (the 4 being the admin's own browsing), the beacon was missing from the deployed HTML: commit `9124593` moved the site tag to `VITE_CF_BEACON_TOKEN`, the Cloudflare Pages build environment had no such variable, and nothing failed loudly. Traffic did not drop — only the measurement did. The Campaign sources card now prints a warning whenever arrivals exceed page loads, and `cf-beacon.ts` keeps a built-in public tag so a missing variable cannot silently disable reporting again.
- Two honest exceptions before blaming the beacon: arrivals on a hostname the panel does not track (the Eazo aliases) count as sessions but not as loads in a host-filtered view, and an ad-blocked visitor is counted by the app but never reaches Cloudflare. Both are small; a gap of the 97-vs-4 size is the beacon.
- To check a deployment by hand: `curl -s https://<host>/ | grep -c beacon.min.js` must print `1`. Zero means that build rendered no beacon — check `VITE_CF_BEACON_TOKEN` (it may be set to `off`) and that the build is a production build.
- The legacy `icse-resources.pages.dev` hub is a **separate Web Analytics site**, so its traffic is deliberately absent from this panel (which reports on `lambda-prep.pages.dev` only) even though it is where many arrivals start.

## The dataset workflow panel

The part worth reading twice.

`update-resources.yml` runs on demand (the panel’s “Update resource datasets” button) and every Monday on a cron, so the panel is a “run it now” control rather than the only way to refresh. GitHub’s API exposes **step status while a run is in flight**, but job logs only after it finishes. So the workflow is split into `[Category]`-tagged steps, and `src/lib/workflow-progress.ts` turns that flat step list into a grouped, friendly view.

### Categories

| Key | Label | What it covers |
| --- | --- | --- |
| `setup` | Setup | checkout, Node, Python, Drive credentials, crawl deps |
| `crawl` | Drive crawl | the Drive tree walk |
| `datasets` | Datasets | transform, split, sort, count |
| `commit` | Commit | secret cleanup, diff summary, commit + push |
| `runner` | Runner | GitHub's own “Set up job” / “Complete job” / `Post …` steps |
| `other` | Other | any step whose name lost its tag |

The `[Tag]` prefix wins; a light alias table (`crawl`/`drive`, `datasets`/`data`, …) absorbs reasonable renames. An untagged step still shows up, under “Other” — the panel degrades instead of breaking.

### What the panel does

1. On mount it attaches to the **newest run**, whether the admin started it or it came from an earlier session — so a run started on another device is visible without clicking anything.
2. It polls every **3 seconds** while a run is live, and re-renders once a second locally so elapsed time and step durations tick between polls.
3. It shows an overall progress bar, elapsed time, and an estimate of time remaining derived from completed categories, then expands into per-category rows with per-step durations and status.
4. Failure rolls up: any failed step marks its category failed, and a cancelled run does not masquerade as success.
5. Recent runs are listed with event type (`scheduled` / `manual`), conclusion, duration and a link to the GitHub run.
6. **Dispatch is guarded** — the run button is disabled while a run is queued or in progress, and the dispatch is confirmed first, so a double click cannot queue two crawls (they would collide on the same generated files; the workflow's own `concurrency` group is the second line of defence).
7. When a run finishes, the panel refreshes the Drive-derived counts so the dashboard reflects the new datasets without a reload.

### Configuration

The panel is driven by `github_integration` (single row): `pat`, `owner`, `repo`, `workflow_file`, `ref`.

> **After the rename, this row must point at the new repository:** `owner = Jivaansh-Yadav`, `repo = lambda-prep`, `workflow_file = update-resources.yml`, `ref = main`. If it still points at the old repository the panel shows “Could not reach the GitHub integration” or tracks a workflow that is no longer the live one.

The PAT only needs **Actions: Read and write** plus **Contents: Read**, scoped to this repository (a classic token needs `public_repo`). It is stored in the database, never in the bundle, and it is the site's own credential — not the platform token used by the build tooling. An empty `pat` is supported: the cards read GitHub anonymously, and only the dispatch button reports the missing token. The full permission table is in [Operations-Runbook](Operations-Runbook).

## Other admin surfaces

- **Manage resources** — a live Drive browser rooted at `drive_integration.folder_id` (not the committed JSON), with upload into the current folder, rename, and delete-to-trash. Folder/file ids are validated (`isDriveId`) before any write, and failed uploads report the Drive API's reason. It does not change which folder the crawl starts from.
- **Resource stats** — the same 24h/7d/14d/30d selector, scoping all four tabs (ratings, comments, views, shares) to "files active in this window". Read from the same `resource_*` tables the public counters write, with two honest limits: the window selects rows from day buckets, so 24h means today so far (IST), and shares only keep a running total plus `last_shared_at`, so the count stays all-time and is labelled as such. A window that has no activity says so instead of falling back to all-time numbers.
  - **Every list opens on its time column, newest first** — Views → Last viewed, Ratings → Last rated, Comments → Submitted, Shares → Last shared — so the file someone just touched is the file at the top, with no click.
  - **Every header is a toggle.** File, counts, averages and timestamps sort on first click (descending) and flip to ascending on the second; the active column shows a solid arrow, the rest a faint one, and `aria-sort` carries the state to screen readers. Comparators live in `src/lib/table-sort.ts` so the edge cases are testable rather than buried in JSX: a null sinks to the bottom **in both directions** (a file with no timestamp should never out-rank one touched a minute ago), names compare case-insensitively with numbers in order (`Chapter 2` before `Chapter 10`), and views fall back to a day bucket when a row predates exact timestamps.
  - **The "Last viewed" cell is a real clock time.** `resource_daily_views` stores a `DATE`, so it can only ever say which day; the wall clock comes from `resource_views.last_viewed_at`, read alongside the all-time count. Rows recorded before that column existed fall back to `Nov 18 (day)`.
- **Contributed resources** — the queue from `/contribute`: approve or reject, and the schema records `status` and `reviewed_at`. There is no free-text note column: one existed (`admin_notes` on both this table and `contact_messages`) but nothing ever wrote it and every status change overwrote it with `NULL`, so it was dropped rather than left as a field an admin could fill by hand and lose.
- **Contact messages** — footer messages with the same review shape, plus optional Discord/Reddit handles.

## Design notes

- Group labels (`Analytics` / `Manage`) exist so the page reads as two decisions instead of eight equal buttons.
- Accents are semantic, not decorative: cool = look, warm = act.
- Cards are single-purpose and link-shaped; the only nested control is the run button inside Manage resources, which is why it opens a section rather than acting inline.
- Mobile-first: one column below `sm`, two at `sm`, four at `lg`. This was a real bug once — `flex-basis` on the card row made two cards overlap at 400 px.

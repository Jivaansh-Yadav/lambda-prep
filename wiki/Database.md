# Database

Neon Postgres, reached over `@neondatabase/serverless` (HTTP driver — no TCP pool, works from an edge worker). `src/lib/db.ts` exports a `sql` client that is `null` when `DATABASE_URL` is unset, and every caller handles `null` by reporting "not configured" rather than throwing.

```ts
const databaseUrl = process.env["DATABASE_URL"];
export const sql = databaseUrl ? neon(databaseUrl) : null;
```

That single `null` check is the whole degraded mode: **the catalogue renders, the counters are inert.** That is the intended behaviour on a fresh clone without a database, and it is what makes preview environments cheap.

## Tables

### Content counters

| Table | Written by | Semantics |
| --- | --- | --- |
| `resource_ratings` | `ratings-server.ts` | One row per `(file_id, voter_id)`; a student can change their own rating |
| `resource_views` | `views-server.ts` | Increment per file open |
| `resource_daily_views` | `views-server.ts` | The same opens, bucketed per `(file_id, day)` — what the Trending strip reads |
| `resource_shares` | `shares-server.ts` | Increment per share action / copied link |
| `resource_comments` | `comments-server.ts` | Public comments on a file — read by every visitor under the star rating, and by the admin Comments table |
| `resource_contributions` | `contribute-server.ts` | Student-submitted resources, with `status` and `reviewed_at` |
| `contact_messages` | `contact-server.ts` | Footer contact form, same review shape plus optional social handles |

Design rules that matter:

- **No bulk seeding.** A file gets a row only after real activity. There is no “0 ratings” row per file, so the table grows with usage, not with dataset size.
- **Counters increment one column and return the new value**, so the number a student sees is the number everyone sees. A client-side counter is a counter you cannot aggregate or trust.
- **Ratings are per visitor.** There is no sign-in, so `voter_id` is a random per-browser id in `localStorage` (`voter-id.ts`) — enough to let a student see and change their own rating, and to blunt accidental double submits. It is not an identity guarantee and is not treated as one.
- **Abuse protection on every public write** (`ratings`, `comments`, `contact`, `contribute`): a light in-memory per-IP + voter limit (e.g. `10 submissions / 10 minutes` for ratings) plus a validity check that the `file_id` actually exists in the dataset. The limiter resets on deploy and a determined attacker can rotate IPs — it exists to stop naive scripted brigading and junk rows, which is the realistic threat for a school portal.
- **Editor's Choice** is computed from these rows (`average rating`, minimum count), never from a hand-written list.

### Daily view buckets

`resource_daily_views` exists because a lifetime counter cannot answer "what is being opened *now*". One row per `(file_id, day)`, keyed the same way, with `class_slug`, `subject`, `source` and `file_name` copied in at write time so the Trending read never has to join back to the JSON datasets.

- **The day boundary is IST, and Postgres owns it.** Writes and reads both bucket with `(now() AT TIME ZONE 'Asia/Kolkata')::date`, so a file opened at 01:00 IST counts towards the new day, and no two instances can disagree about which day it is.
- **Ranking is class + subject scoped.** `getTrendingFiles` filters on `class_slug` and, on a subject page, on `subject`; rows with a null `subject`/`source` (older writes, or a viewer with no class context) cannot be ranked or deep-linked, so they are excluded rather than guessed at.
- **The window widens instead of the list shrinking.** The strip asks for five files; if today cannot fill five, the same rows are re-aggregated over 2 days, then 3, up to 7. Views are summed per file across the window, so three separate days of opens outrank two today. One query covers the widest window and the widening happens in memory.
- **It is a read-only convenience.** Recording a daily view is wrapped so a failure there can never break the view counter, and a failed trending read renders nothing rather than an error state.
- **It carries no clock.** `day` is a `DATE`, so the bucket can say *when by day* but never *when by minute*. Anything that needs an exact moment — the admin "Last viewed" column, "last shared" times, relative-time day fallbacks — reads `resource_views.last_viewed_at` (a `timestamptz`) instead, and treats it as optional: rows written before that column existed have no time and say so (`Nov 18 (day)`) rather than inventing midnight.

### Attribution

| Table | Written by | Semantics |
| --- | --- | --- |
| `campaign_visits` | `campaign-server.ts` (from `campaign-tracking.ts` in the browser) | One row per session per distinct set of utm tags on the landing URL |
| `outbound_clicks` | `outbound-server.ts` (from `outbound-tracking.ts`) | One row per session per Doxxmarks entry point, recording where the visitor was sent |

`campaign_visits` exists because neither other analytics source can answer "which link did this visit come from". Reddit, Discord, Slack and Gmail send no `Referer`, and Cloudflare's RUM dataset drops query strings, so `?utm_source=reddit` is invisible there. The browser reads the tags itself, keeps a `sessionStorage` marker so reloads and internal navigation don't add rows, and posts once; the row carries `source` / `medium` / `campaign` / `content` / `term`, the landing path, the referrer hostname when there is one, and the country from Cloudflare's `cf-ipcountry` header. Values are re-normalised on the server (lowercase, `[a-z0-9._~:/+-]`, length-capped) and the write is rate limited per IP like the other public counters.

Because a row is written at most once per session, `COUNT(*)` reads as *sessions that arrived from this link* — not page views, and not unique people (there is no identity to dedupe on).

`outbound_clicks` is the mirror image: it records where this site *sent* someone. Every "Open Doxxmarks" link writes one row before navigating — `destination` (allowlisted to `doxxmarks`), `entry` (`lp` or `class-hub`), `board`, `class_slug`, `subject`, the `path` the click happened on, `country` from `cf-ipcountry`, and `created_at`. As with campaigns there is one row per session per entry point (a `sessionStorage` key), so `COUNT(*)` is *sessions sent to Doxxmarks*, not clicks. The write is fire-and-forget: a failed insert must never delay the navigation, so the server function always resolves and the link still works.

`outbound_clicks` is also what makes the UTMs verifiable from this side. `utm_medium` is derived from the same `entry` value written here, so "class-hub sent 40 sessions" and Doxxmarks' own `utm_medium=class-hub` count should agree within a session or two — a gap wider than that means the link builder and the tracker have drifted.

### Integrations (one row each)

| Table | Columns (abridged) | Used for |
| --- | --- | --- |
| `drive_integration` | `service_account_json`, `folder_id`, `oauth_client_id`, `oauth_client_secret`, `oauth_refresh_token` | Crawling Drive, listing a class folder, contributing uploads |
| `github_integration` | `pat`, `owner`, `repo`, `workflow_file`, `ref` | Dispatching and tracking the dataset workflow |
| `cloudflare_integration` | `account_id`, `rum_api_token` | Cloudflare GraphQL analytics + Web Analytics (RUM) |

All three are **seeded by hand** in the Neon SQL editor (the admin panel only prints instructions, it has no write path) and read through a `LIMIT 1` `id = true` row — one integration of each kind per deployment, which keeps the queries trivial and the UI honest.

`cloudflare_integration` used to carry a `rum_site_tag` column. Nothing reads it: the admin analytics queries filter Cloudflare's RUM dataset by request hostname (from `SITE_URL`) instead of by site tag, precisely because a tag is bound to one hostname and silently returns zero after a domain move. The column can be dropped.

> After the rename, `github_integration` must point at `Jivaansh-Yadav/lambda-prep`. See [Admin-and-Analytics](Admin-and-Analytics).

`insta_revision_integration` is gone. It held the HTTP Basic pair for `upload.extramarks.com/getSignedUrl`, which existed only to sign revision-note PDFs for the in-app Doxxmarks player. Both the player and the crawl that used the pair were removed, so the row was dropped with nothing left to read it — see [Operations-Runbook](Operations-Runbook) for what to do if a copy of the pair survives outside git.

### Caches

| Table | Key | Content |
| --- | --- | --- |
| `cloudflare_analytics_cache` | range (`24h`, `7d`, `14d`, `30d`) | GraphQL totals + visits by path |
| `cloudflare_rum_cache` | range | RUM visit series, referrers |

Both exist because Cloudflare's analytics APIs routinely take seconds, and the dashboard has to open instantly. A stale cache is preferred over a spinner, and the range is part of the key so switching ranges does not clobber the other three.

## Migrations

There is no migration runner. Tables were created by hand in the Neon SQL editor, and that is still the process — the one exception is `resource_daily_views`, whose `CREATE TABLE IF NOT EXISTS` lives in `scripts/create-resource-daily-views.mjs` because the Trending strip arrived after the schema-by-hand era; running that script is the whole migration.

Consequences worth knowing:

- The app does **not** boot-create its own tables. A fresh database with `DATABASE_URL` set but no tables fails at query time, and the failure surfaces as a server error (the admin panel now prints it) rather than a silent "not configured" — the `sql === null` path only covers a *missing* `DATABASE_URL`.
- To add a table, write the `CREATE TABLE` in Neon first (or in a one-shot `scripts/` script, like `create-resource-daily-views.mjs`), then add the reader in the server module that owns it.
- Nothing is dropped automatically. Clean-up is a manual decision. Two columns and one table have been dropped so far:
  - `analytics_history` — an orphan from the pre-Cloudflare analytics design (two rows ever inserted, then deleted, and no reference in `src/`, `scripts/` or the wiki once `cloudflare_analytics_cache` / `cloudflare_rum_cache` took over). Removing it removed the last reason to believe the site keeps its own pageview history.
  - `admin_notes` on `contact_messages` and `resource_contributions` — write-only schema. The server functions accepted the field, no call site ever sent a value, and every status change therefore wrote `NULL` over anything set by hand. Dropping it is cheaper than teaching the panel to edit a column nothing reads. Review state is `status` + `reviewed_at`.

The two newest tables, `campaign_visits` and `outbound_clicks`, were created with:

```sql
CREATE TABLE campaign_visits (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  medium TEXT,
  campaign TEXT,
  content TEXT,
  term TEXT,
  landing_path TEXT,
  referrer_host TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX campaign_visits_created_at_idx ON campaign_visits (created_at DESC);
CREATE INDEX campaign_visits_source_idx ON campaign_visits (source, created_at DESC);

CREATE TABLE outbound_clicks (
  id BIGSERIAL PRIMARY KEY,
  destination TEXT NOT NULL,
  entry TEXT NOT NULL,
  board TEXT,
  class_slug TEXT,
  subject TEXT,
  path TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outbound_clicks_created_at_idx ON outbound_clicks (created_at DESC);
CREATE INDEX outbound_clicks_destination_idx ON outbound_clicks (destination, entry, created_at DESC);
```

## Local/dev

Set `DATABASE_URL` to a Neon connection string in `.env` (or the shell) for the dev server to enable counters and admin. Without it:

- catalogues, search, the Doxxmarks links and sharing work;
- ratings/views/shares silently no-op;
- `/admin` reports that the integration is not configured instead of erroring.

Production sets `DATABASE_URL` in the Pages project environment (see [Deployment](Deployment)).

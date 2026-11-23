# Doxxmarks hand-off

Chapter videos and interactive classes live on **`https://doxxmarks.pages.dev`**, a separate app. Lambda Prep no longer carries a Doxxmarks catalogue, player, revision-note mirror or iframe: it links out, and it counts the exits.

That split is deliberate. The lesson data belongs to Doxxmarks, it changes on its own schedule, and the old in-app copy duplicated a 4 MB dataset plus a hand-run Extramarks crawl that broke every time a token expired. Removing it left one contract to maintain instead of two copies to reconcile.

## The link contract

Every link is built by `doxxmarksUrl()` in `src/lib/doxxmarks.ts` and rendered by `DoxxmarksLink`. No component assembles a Doxxmarks URL by hand; if one did, the UTMs would drift within a week.

| Where | `utm_medium` | Extra parameters |
| --- | --- | --- |
| Hero button, header nav, quick search, 404 page | `lp` | `board=ICSE` |
| Class hub header button, subject dialog | `class-hub` | `board`, `class`, and `subject` from the dialog |

- `utm_source` is always `lambda-prep`, so Doxxmarks' own analytics can separate this site's traffic from every other source.
- `board` and `class` are passed so the visitor lands on the right class instead of a board chooser. `subject` is passed from the subject dialog so they land on the right subject.
- **ISC 11 and ISC 12 are sent as `board=ICSE&class=icse-11` / `icse-12`.** Doxxmarks publishes those two classes under ICSE — its own `classSlug()` lowercases the board — and `board=ISC` makes it render "Select your board." The translation lives in `doxxmarksClassSlug()`.

Live examples:

```
https://doxxmarks.pages.dev/?board=ICSE&utm_source=lambda-prep&utm_medium=lp
https://doxxmarks.pages.dev/?board=ICSE&class=icse-11&utm_source=lambda-prep&utm_medium=class-hub
https://doxxmarks.pages.dev/?board=ICSE&class=icse-11&subject=Computer+Science&utm_source=lambda-prep&utm_medium=class-hub
```

All three open with `target="_blank"` and `rel="noopener noreferrer"`.

## Counting the exits

`DoxxmarksLink` records the click before the browser leaves, so the panel can answer "how many students did we send there, and from where?" — see [Admin-and-Analytics](Admin-and-Analytics#doxxmarks-exits--what-the-hand-off-sends-and-where-it-went) for the reading side.

- `recordOutboundClick` (`src/lib/outbound-server.ts`) writes to `outbound_clicks`: destination, entry (`lp` / `class-hub`), board, class slug, subject, the path the click happened on, country, timestamp.
- `outbound-tracking.ts` keeps a `sessionStorage` flag per entry point and class, so repeated clicks in one session count once; the server deduplicates nothing and protects itself with a per-IP limit instead.
- The call is fire-and-forget. A database outage must never sit between a student and the lesson.

Because the destination is allowlisted in the server function, this endpoint cannot be repurposed as an open redirect logger.

## What was removed, so it stays removed

| Removed | Was |
| --- | --- |
| `src/routes/doxxmarks.tsx` | Curriculum browser and player at `/doxxmarks` |
| `src/lib/{curriculum,doxx-categories,doxx-search}.ts` | Chapter tree, subject categories, note search |
| `src/components/lambda-prep/{doxx-watch,doxx-thumb,note-pdf-watch}.tsx` | Sandboxed lesson iframe, thumbnails, PDF note viewer |
| `src/data/{doxxmarks_resources.json,insta-revision-sources.json}` | The 4 MB catalogue and its bucket-path source list |
| `scripts/crawl-curriculum.mjs`, `scripts/drive-crawl/{sync-doxxmarks-videos,apply-doxx-thumbnails,apply-insta-revision-notes,discover-insta-revision-sources}.mjs` | The Extramarks crawl, video backfill, cover join, note-link rewrite |
| Workflow steps `[InstaRevision]` and `[Covers]` | The two pipeline steps that rewrote the catalogue |
| `insta_revision_integration` (Neon, already dropped) | HTTP Basic pair for `upload.extramarks.com/getSignedUrl` |
| Sitemap entry, `mscontent-gcp.extramarks.com` + `storage.googleapis.com` in the CSP | The route and the two origins only the player needed |

`/doxxmarks` now renders the 404 page, which offers the same `utm_medium=lp` link. Old bookmarks and printed QR codes therefore land somewhere useful instead of a dead end.

## If a link misbehaves

1. **Board chooser instead of a class** — the class slug is not one Doxxmarks publishes. Only `icse-*` exists; check `doxxmarksClassSlug()` and the `classSlug` passed by the class page.
2. **Right class, wrong subject** — the subject label must match Doxxmarks' own spelling (`Computer Science`, not `Computer`). The dialog passes the same name the class page displays.
3. **Admin card shows nothing** — first confirm the click wrote a row (`SELECT * FROM outbound_clicks ORDER BY id DESC LIMIT 5`), then check the selected range; the card prints the all-time total underneath precisely because a 24h window is often empty.
4. **Row written, card empty** — the panel calls `getAdminDoxxmarksExits`, which is passcode-guarded like the rest of `/admin`; an expired gate returns nothing rather than an error.

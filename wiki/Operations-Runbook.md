# Operations runbook

## Routine

| Cadence | What happens | Who |
| --- | --- | --- |
| When Drive content changes | `/admin` → Update resource datasets: re-crawls Drive, rebuilds datasets, commits, and Pages redeploys | creator, manual |
| Weekly, Monday 03:23 UTC | The same workflow on a cron, so a Drive edit ships without anyone pressing the button. No upstream change means no commit, so an idle week is silent | GitHub Actions |

## Health check (2 minutes)

```bash
curl -sI https://lambda-prep.pages.dev/ | head -3                         # 200
curl -s  https://lambda-prep.pages.dev/ | grep -c 'rel="canonical"'       # 1
curl -sI https://lambda-prep.pages.dev/drive  | grep -i location         # Drive folder
curl -sI https://lambda-prep.pages.dev/github | grep -i location         # repository
curl -s  https://lambda-prep.pages.dev/sitemap.xml | head -5             # absolute URLs
```

Then open `/classes/isc-11`, click **Open Doxxmarks** and confirm the new tab lands on the ICSE Class XI page with `utm_source=lambda-prep&utm_medium=class-hub` in the address bar. That single check covers the link builder, the class-slug translation and the UTM contract; `/admin` → analytics → **Sent to Doxxmarks** should then show the visit.

## Failure playbook

### A Doxxmarks link lands on the board chooser

Doxxmarks only publishes `icse-*` class slugs. `board=ISC` (or a raw `isc-11`) makes it render "Select your board." instead of a class, so `doxxmarksClassSlug()` maps ISC to ICSE on the way out. If a link regresses, check that the class page passes `current.slug` unchanged and that the builder still translates it.

### Iframe is blank but the URL works in a new tab

- PDF viewers need `allow-same-origin` in the sandbox attribute; a fully sandboxed frame renders white.
- Check `frame-src` in **both** `src/server.ts` and `public/_headers`. It must include `drive.google.com` and `docs.google.com` for the Drive PDF viewer, and nothing else — the Extramarks and revision-note origins left with the player, so re-adding one is a signal that something was copied back in.

### Fullscreen button does nothing inside an embedded frame

`Permissions-Policy` must list the frame's origin in `fullscreen=(self "…")`. An `<iframe allow="fullscreen">` can only narrow the header policy, never widen it, so the origin has to be in `src/server.ts` **and** `public/_headers`.

### Analytics cards show zeros

1. `/admin` → Deep analytics prints whether the integration is configured.
2. Check the hostname printed under the traffic chart ("Counting … only"). The panel reads exactly one host, taken from `SITE_URL` in `src/lib/lambda-prep.ts`; if that is not the domain actually serving the app, the numbers stay empty. Fix `SITE_URL` and deploy.
3. Check the cache tables are not stuck on a stale range key.
4. Compare against the Cloudflare dashboard. The panel filters to `SITE_URL`'s hostname and drops bot traffic, so a Pages card for the same host should match within a few minutes of lag on today's bucket.

### 14d or 30d disagrees with 7d

Symptom: the long ranges report fewer page loads for a day the 7d range reports in full, sometimes losing a quiet day entirely, and the numbers never move when you refresh.

That was Cloudflare's adaptive sampling, not the cache: a single query wider than ~7 days is downsampled, so 14d/30d were asking one big question instead of three to five small ones. Both panels now read every range in ≤7-day slices (`src/lib/rum-windows.ts`) and sum per bucket, so overlapping days match to the event.

If they ever drift again:

1. Press **Refresh** in Deep analytics — it deletes that range's row from `cloudflare_analytics_cache` / `cloudflare_rum_cache` before calling Cloudflare, so a stale row cannot survive it.
2. Confirm the build includes the slicing: `grep -r "7-day slices" .output/` (or the panel footer under the traffic chart).
3. Compare the day in question against a hand-run 7-day query; if the hand-run matches the panel, the window chunking is intact and the difference is in Cloudflare's own numbers.

### Campaign sources card is empty

That card reads `campaign_visits` in Neon — the app's own table — not Cloudflare. Nothing appears until somebody arrives on a URL carrying a tag:

```
https://lambda-prep.pages.dev/?utm_source=reddit&utm_medium=post&utm_campaign=class10
```

1. Confirm the link people are clicking actually has `utm_source` (or the `?ref=` shorthand) on it — the tag has to be on the *landing* URL, since that is read once on first load.
2. One row is written per session per distinct set of tags, so the same visitor reloading is not counted twice; a second person on the same link is.
3. If the row is missing entirely, check `DATABASE_URL` — the write no-ops when it is unset, and the panel prints "could not read campaign_visits".
4. Test data can be deleted with `DELETE FROM campaign_visits WHERE campaign = 'verify'`.

### “Could not load analytics” after unlocking

The panel now prints the underlying reason. The common ones:

| Message | Cause | Fix |
| --- | --- | --- |
| `Passcode rejected` | the passcode changed (or the IP is throttled) between unlocking and the request | unlock again |
| `Cloudflare's API answered HTTP 401/403 with a non-JSON body` | RUM API token revoked, expired, or missing `Account → Analytics → Read` | mint a new token, update `rum_api_token` |
| `Could not read the cloudflare_integration row from Neon` | `DATABASE_URL` wrong/missing on this deployment, or Neon unreachable | check the Pages env var, then redeploy (env vars are baked per deployment) |
| `Web Analytics isn't configured yet` | no `cloudflare_integration` row | seed it (account id + `rum_api_token`) |

### Visits reads 0 while page loads are not

`Visits` is Cloudflare's `sum.visits`: a visit is counted on the page load that brought someone in from **outside** the site, so internal navigation adds page loads without adding visits. Visits therefore sit far below page loads, and the two can legitimately diverge by 5–10×. A flat zero is different — it means the metric, not the traffic, is missing.

1. The panel already guards this: when a window returns page loads but zero visits, `admin-server.ts` re-asks Cloudflare for the loads whose `refererHost` is not the tracked host (`VISIT_FILTER`) and uses those counts. That reproduces `sum.visits` exactly on this site's data.
2. If it still reads 0, check the freshness line — `Cached · <time>` means the last five minutes' snapshot; press **Refresh** to force a live read and clear the range's cache row.
3. Check which host the panel is counting: Deep analytics prints "Counting `<host>` only" under the traffic chart. A host Cloudflare does not instrument falls back to the canonical `SITE_URL` host automatically.
4. If the whole panel is empty, this is the credentials path, not the metric — see the "Could not load analytics" table below.

### New domain

The admin panel filters Cloudflare's RUM dataset by **request hostname** — the host in `SITE_URL` (`src/lib/lambda-prep.ts`) — not by Web Analytics site tag. So a domain move is a one-line change:

1. Change `SITE_URL` to the new origin. Sitemap, canonical link, OG tags and the analytics filter all follow it.
2. Deploy. Nothing else in Cloudflare needs to be touched: Pages reports page loads for the project hostname, so the new host starts appearing in the dataset on its own. The old host's history stays in Cloudflare — the panel simply no longer reads it.
3. Optionally clear the per-range caches so the dashboard does not keep serving pre-move numbers for up to five minutes:
   ```sql
   DELETE FROM cloudflare_analytics_cache;
   DELETE FROM cloudflare_rum_cache;
   ```

There is no beacon token to rotate. The site ships **no** hand-installed Web Analytics beacon: Cloudflare Pages collects page loads for the project's own hostname, and a hand-installed beacon only works while its site tag stays bound to the exact hostname in the page (a stale tag silently drops every event — that is what once left the panel empty). Add a snippet back only if the app is ever served from a host Cloudflare does not instrument, and remember its events then arrive under that site's own host in the dataset.

### Workflow panel says “Could not reach the GitHub integration”

The `github_integration` row is wrong or the PAT expired. Required: `owner = Jivaansh-Yadav`, `repo = lambda-prep`, `workflow_file = update-resources.yml`, `ref = main`. **This row still pointing at `lambda-prep-test` is the expected breakage after the rename.**

A revoked PAT is the common case and shows up as `HTTP 401 Bad credentials` — a `lambda` repo value is the same bug seen through a rename, since GitHub redirects the read but not the dispatch `POST`. Since the repo is public, a dead PAT no longer blanks the admin cards: `githubGet` retries read-only calls anonymously, so the “Latest commit” and run-history cards keep working and only the dispatch button refuses, with an error that says to replace the PAT. A dispatch can therefore fail on a page that otherwise looks healthy — check the token before assuming the workflow is gone.

### What the admin PAT needs — and what it must not be

The app calls exactly three things, so the token is small on purpose:

| Call | Used by | Fine-grained PAT | Classic PAT |
| --- | --- | --- | --- |
| `GET /repos/{owner}/{repo}/commits/{ref}` | “Latest commit” card | **Contents: Read** | `public_repo` |
| `GET /repos/{owner}/{repo}/actions/workflows/{f}/runs`, `/actions/runs/{id}`, `/actions/runs/{id}/jobs` | run history, live step progress | **Actions: Read** | `public_repo` |
| `POST /repos/{owner}/{repo}/actions/workflows/{f}/dispatches` | “Update resource datasets” | **Actions: Write** | `public_repo` |

So: **Actions: Read and write** + **Contents: Read**, scoped to `Jivaansh-Yadav/lambda-prep` only (Metadata: Read is added automatically and cannot be removed). A classic token needs `public_repo` — not `workflow`, which is for editing workflow *files* through the API and does not help a dispatch.

Never put the platform's own GitHub credential in this row. The Eazo-managed `GH_TOKEN` is used by the build/push tooling, not by the running app; the admin row is the site's own integration and is read on every admin request. An empty `pat` is a supported state: the read-only cards fall back to anonymous GitHub calls and the dispatch button says a token is missing.


### Crawl fails with 403

The service account lost access to the Drive root (`1Dref01UoCLaP6DrQHRxqY1Nrj-f5illc`). Re-share the root with the service-account email, then re-run. The key itself is the `drive_integration.service_account_json` row in Neon, which `[Setup] Fetch Google Drive credentials` reads through the `DATABASE_URL` secret; if neither reaches the runner, the run fails earlier with `❌ No credentials`.

### Dataset commit looks wrong (files disappeared)

1. Read the `[Commit] Summarize dataset diff` block in the run summary — it prints `git diff --stat -- src/data`.
2. `git revert <chore commit>` and push. Pages redeploys the previous datasets in about a minute.
3. Investigate Drive: a folder rename makes the crawl skip a class, which the transform faithfully reflects.

### Two runs queued at once

Should not happen: the panel disables dispatch while a run is live, and the workflow's `concurrency` group (`cancel-in-progress: false`) serialises the rest. If it does, let them finish — the second is a no-op commit.

### Site down / needs to be taken offline

1. Cloudflare Pages → Deployments → **Rollback** to the last good build (instant), or
2. Pages → Settings → disable the deployment / add a `_redirects` catch-all, remembering that a catch-all also blocks the worker path, so `src/server.ts` needs the same rule for hosts that bypass the file.

The old Vercel deployment used a takedown redirect in both `public/_redirects` and `src/server.ts`; that mechanism was removed with the rename and replaced by the `/drive` + `/github` short links.

## Secrets to rotate

| Secret | Where | Rotation effect |
| --- | --- | --- |
| `drive_integration.service_account_json` (Neon) | DB row | Next run picks it up automatically — no secret to update |
| `DATABASE_URL` | GitHub Actions secret | None until next run — the Drive service-account key is read with it |
| `DATABASE_URL` | Pages env | Requires a redeploy |
| GitHub PAT (Actions) | `github_integration` row, via `/admin` | Immediate |
| Cloudflare RUM token | `cloudflare_integration` row | Immediate, cache may serve stale numbers until it expires |

### Retired signing credential

No Extramarks signing credential is used any more. The HTTP Basic pair that lived in `insta_revision_integration` (a `getSignedUrl` oracle) has been dropped along with the code that read it, and the notes it used to sign are no longer served from this app at all.

If any copy of that pair still exists outside git — an old working tree, a local `.env`, a CI log, a screenshot, a chat thread — treat it as leaked until Extramarks confirms it was revoked. `DROP TABLE` removes our copy, not theirs.

## Known follow-ups

- `public/_redirects` and `src/lib/redirects.ts` duplicate the two destinations by nature (one is static). Keep them in sync; they are two lines each.
- Dataset JSON files are large enough that GitHub diffs are unreadable. Trust the `--stat` summary in the run log, not the file diff.

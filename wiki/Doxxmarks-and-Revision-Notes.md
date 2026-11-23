# Doxxmarks and revision notes

Doxxmarks is the chapter-wise layer of the portal: classes → subjects → chapters → **revision notes** (PDFs) and **interactive classes / concept videos**. It is a different content shape from the class catalogues: the PDFs are not on Google Drive, and every link in it is permanent.

## The dataset

`src/data/doxxmarks_resources.json` is the single committed source of truth for Doxxmarks. Its shape:

```
{
  "boards": {
    "ICSE": {
      "classes": {
        "X": {
          "subjects": [
            {
              "name": "Biology",
              "chapters": [
                {
                  "name": "Genetics - Some Basic Fundamentals",
                  "revisionNotes": [ { "name", "link", "thumb?" } ],
                  "topics": [
                    {
                      "name": "…",
                      "interactiveClasses": [ { "name", "link", "thumb?" } ],
                      "videoLessons":      [ { "name", "link", "thumb?" } ],
                      "activities":        [ { "type", "title", "link", "thumb?" } ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  }
}
```

Two rules that must not be broken:

1. **The `link` is a plain public URL, nothing else.** No signed queries, no expiry timestamps, no second manifest. A note URL is a pure function of the object path, so a stale copy has nothing to drift *to*.
2. **`revisionNotes` is written by the pipeline, not by hand.** The chapter skeleton (names, order) is hand-structured and stable; the note arrays come from `src/data/insta-revision-sources.json`.

## Where the PDFs live

The notes are uploaded to Extramarks' private bucket `gs://em_content_private`, but the same objects are readable through the public mirror `gs://emnewcontent` under a `beta/` prefix:

```
gs://em_content_private/content_data_private/PDF/…/Revision_Notes_ICSE_X_Force.pdf
gs://emnewcontent/beta/content_data_private/PDF/…/Revision_Notes_ICSE_X_Force.pdf

→ https://storage.googleapis.com/emnewcontent/beta/content_data_private/PDF/…/Revision_Notes_ICSE_X_Force.pdf
```

Consequences that matter for everything below:

- **No signing, anywhere.** There is no `getSignedUrl` call, no GCS V4 URL, no 7-day clock to beat. The previous pipeline minted signed URLs from a `Basic` credential on `upload.extramarks.com`; that whole path is gone, along with the `insta_revision_integration` Neon row that held the credential.
- **Nothing rotates, so nothing *has* to run weekly.** The note URLs never expire; the weekly `schedule:` on `update-resources.yml` (Mondays 03:23 UTC) exists to pick up new Drive content, and the admin panel's “Update resource datasets” button dispatches the same workflow by hand.
- **A moved object still 404s.** Public does not mean stable: if the PDF is re-uploaded under a new path, the old URL returns `404` while the private copy keeps working. Re-running discovery is what fixes that.

## The single step

```
apply-insta-revision-notes.mjs   reads src/data/insta-revision-sources.json
                                 → turns each folderPath into a public URL
                                 → matches it onto a chapter in doxxmarks_resources.json
                                 → rewrites that chapter's revisionNotes
```

It runs inside the workflow as one `[InstaRevision]` step, after `[Datasets]` and before `[Commit]`. It is a local file rewrite: no credentials, no network, no Neon, so it can be run by hand at any time:

```
node scripts/drive-crawl/apply-insta-revision-notes.mjs
```

### Matching key

`(board, class roman, subject name, normalised chapter name)`

- `insta-revision-sources.json` stores Drive folder labels like `ICSE - X` / `ISC - XI`; the step maps those to `(board, roman)` first.
- Chapter names are normalised (lowercased, punctuation collapsed, one trailing `s` stripped) before comparison, so `Genetics – Some Basic Fundamentals` in Drive still matches `Genetics - Some Basic Fundamentals` in the dataset.
- A note that matches no chapter is **reported, not fatal**: the step prints a warning and exits non-zero so the run summary shows it, but the rest of the dataset is still written.
- A fixed chapter whose subject does not exist for that class simply never matches — e.g. an ISC XII “Physics” fixture will match zero chapters, because ISC XII subjects are Biology, Chemistry, English Language, Literature in English, Geography, Hindi, and so on.

## Rendering

- **Subjects with nothing in them are not rendered.** Extramarks lists syllabus nodes it published no material for — ISC XI and ISC XII Environmental Science and Home Science are the current examples: one chapter each, no lessons, no activities, no notes. `buildCurriculumClasses` in `curriculum.ts` drops a subject when every chapter is empty, so the class card, the subject grid, the Doxxmarks search index and the deep-link fallback all stop offering a dead end. It reads the *cleaned* arrays, so a lesson with a blank link or an activity the crawler marked `BROKEN` does not count as content. **Chapters are deliberately not filtered**: `?chapter=<index>` points into the chapter array, so removing an empty chapter would shift every later share link. Thirty-two chapters are empty today (Chemistry Practical, English - Vocabulary, several Hindi and Literature sets) and still render with an empty state.
- **`/doxxmarks`** — `class` (slug), `subject` (display name), `chapter` and `note` are **indices**, not names. A share link therefore looks like `?class=icse-10&subject=Biology&chapter=0&note=0` and stays valid as long as the chapter order is stable. The raw bucket URL is never the share target. A link to a dropped subject (say `?subject=Home%20Science`) falls back to that class's subject list instead of erroring.
- **`note-pdf-watch.tsx`** — the note viewer. The PDF is embedded as an `<iframe>` pointing straight at the public URL, with an overlay toolbar (open in new tab, copy link, share) positioned top-left so it never sits under the frame's own chrome.
- **`doxx-watch.tsx`** — the lesson player: `@videojs/react` with an HLS source, plus a playlist of the chapter's other lessons.
- **Fullscreen** — the player and the PDF viewer both need fullscreen from inside a framed document. That is why `Permissions-Policy` in `src/server.ts` lists `fullscreen=(self "https://mscontent-gcp.extramarks.com" "https://drive.google.com")` instead of `fullscreen=()`, and why `_headers` carries the same value.
- **Sandboxing** — embedded third-party frames are sandboxed, but PDF viewers need `allow-same-origin` to render at all; removing it produces a blank white frame (this was a real regression, see the Resources section of the runbook).

## Cover art

Every material carries an optional `thumb` (a plain public image URL, same no-signing rule as the PDFs). Cards render it through `doxx-thumb.tsx`; when `thumb` is absent the card falls back to a tinted icon tile with that content family's Extramarks template washed in underneath (`public/covers/`), so a missing cover is a normal state and never a broken image.

```
apply-doxx-thumbnails.mjs   reads the catalogue Jivaansh-Yadav/doxxmarks publishes
                            → joins each material to its artwork
                            → HEADs the candidate and drops house splashes
                            → rewrites `thumb` on every material in doxxmarks_resources.json
```

Run by hand with `node scripts/drive-crawl/apply-doxx-thumbnails.mjs`, or as the `[Covers]` step in `update-resources.yml` (after `[InstaRevision]`, marked `continue-on-error` so a catalogue outage cannot fail a dataset refresh). Flags: `--repo`, `--ref`, `--source <dir>` (use a local clone instead of `raw.githubusercontent.com`), `--curriculum`, `--stock-min`, `--no-probe`, `--dry`.

### Joining a material to its artwork

The catalogue is Extramarks' own `public/data/ICSE/{IX..XII}.json`, which lists one entry per object with `thumb`, `path`, `url`, `title`. Three passes, first hit wins, most reliable first:

| Pass | Key | Why it works |
| --- | --- | --- |
| `url` | normalised link (case, trailing slash, `http`→`https`) | exact identity |
| `folder` | the content-folder id inside the link — `…/<id>_dir_V001/` or `…/dir_<id>/` | a lesson, its video and its game share one folder even when filenames differ |
| `title` | class + subject + normalised title | catches videos, whose catalogue URLs are `.mp4` while ours are `.m3u8` |

`apply-thumbs` **deletes every existing `thumb` first** and rewrites from scratch, so the dataset is a pure function of the catalogue — a cover that disappears upstream disappears here too instead of going stale.

### Dropping house artwork

A large share of Extramarks' “thumbnails” are one branded splash copied into hundreds of folders: distinct URLs, byte-identical images (`IcseDL`, `ImageDL`, `DLThumbnail.png`, `ICSEHOTS.png`, …). Two filters remove them:

1. **By filename** — `HOUSE_ART` in `apply-doxx-thumbnails.mjs` (`icsedl`, `imagedl`, `dlthumbnail`, `extramarks`, `logo`, `splash`, `placeholder`, `casestudy`).
2. **By content** — the pass reads `x-goog-hash` from a `HEAD` on every surviving candidate and any image appearing in **at least `--stock-min` (default 2) different folders** is treated as stock and dropped. The rule is per-file rather than global on purpose: a global “used more than N times” cut would also delete genuinely shared subject artwork.

The rule tightens per kind. **Interactive classes** are judged strictly — an image is only trusted if no other topic in the class uses it — because their artwork is either a one-off screenshot or a splash: on the current catalogue that leaves 5 covers out of 1,626, and every other card shows its icon tile, which reads far better than the wordmark. Videos, playables and notes only lose an image that would appear twice on the same page, since a practice-game cover shared by every game of its type is *relevant*, not stock.

Current coverage (printed by every run): **3,934 / 6,083 (65%)** — videos 2,681/2,774, playables 1,202/1,628, notes 46/55, interactive 5/1,626.

### Rendering a cover

`doxx-thumb.tsx` takes `{src, icon, video, template}`. With no `src` — or a URL that fails to load — it renders the tinted gradient tile with the section's glyph over the `template` backdrop (default `library`; HOTS cards pass `case`), so a dead CDN link degrades to the same look as a missing cover instead of a broken-image icon. The two backdrops are the Extramarks splashes the covers pass discards — optimised to ~640px and committed under `public/covers/`, so they never wait on a hotlink and never show up as the *picture* on a card. Videos get a play glyph over the still (`className` carries the size: `.doxx-lesson-cover` for cards, `.doxx-side-thumb` in the playlist, `.doxx-note-thumb` in the note row).

### What it costs

~4.3k `HEAD` requests, about a minute at concurrency 24. `--no-probe` skips them (and the stock filter) for an offline run; `--dry` prints the coverage table without writing.

## CSP consequences

`frame-src` must include:

| Origin | Used for |
| --- | --- |
| `https://drive.google.com` | Drive-hosted PDFs in the resource viewer |
| `https://mscontent-gcp.extramarks.com` | Interactive classes and lesson video |
| `https://storage.googleapis.com` | The public-bucket revision-note PDFs |

`img-src` must include `https://storage.googleapis.com` as well — the cover art and the note PDFs live on the same public mirror, and that origin is needed even on pages that embed nothing.

Adding a fourth embed origin means editing **both** `CONTENT_SECURITY_POLICY` in `src/server.ts` and `public/_headers`, or the iframe works in dev (where the worker header wins) and breaks behind the static host — or the reverse.

## Regenerating the source list

`discover-insta-revision-sources.mjs` is the manual step that rebuilds `insta-revision-sources.json` when the Doxxmarks folder tree changes (new class, renamed subject, new chapter PDFs). It walks the Drive tree, resolves each chapter's PDF folder path, and writes the committed source list. Run it by hand, review the diff, commit — it is deliberately *not* in the workflow, because a rename in Drive would otherwise silently rewrite the curriculum mapping.

Only discovery needs a login; the apply step reads two local JSON files and nothing else.

## Videos the crawl used to lose

A topic that shows fewer videos here than in the doxxmarks app is the symptom of two filters in `crawl-curriculum.mjs`:

1. **The lesson filter.** `isLessonRecord` only accepted HTML/SLM, **Nucleus + CRS** and **Animation + CRS**. Extramarks files plenty of films under Nucleus/SLM, Animation/SLM, Animation/Senior and Animation/IIT_JEE_SLM, so those records were never collected. The rule is now "a film is a film whatever group it is filed under": every Learn record with `Content Type` Nucleus, or Animation with an `.mp4` URL, is a lesson. CRS keeps its subject-tag check, because that group is shared across subjects.
2. **Resolution.** A lesson only became a `videoLessons` entry once `verifyVideo` found the HLS playlist next to its mp4. Anything whose `output/` directory 404s was dropped rather than kept.

The committed dataset was 822 videos short of the doxxmarks catalogue because of this (2,661 against 3,633). Two things close the gap:

- `scripts/drive-crawl/sync-doxxmarks-videos.mjs` fills the file from a doxxmarks `public/data` tree — the same catalogue the doxxmarks app serves — deriving the HLS playlist for each missing film (`<dir>/output/manifest.m3u8`, then `<dir>/output/<name>-hd.m3u8`), keeping the mp4 when no playlist is published, and skipping only media that 404s. Placement reads the catalogue item's **top-level `topic`** first: that is the syllabus node Extramarks filed the item under and the one the doxxmarks app groups by. `meta.Topic` is only a fallback — it is stamped on HTML/SLM records and goes stale, and Nucleus films carry nothing there, so keying off it alone dropped 289 films into the chapter bucket that had a real topic all along (ISC XI Computer Science · Cyber Crime, Malware and Protection of information all belonged under Computer Crime). After the tag comes the topic of a same-titled item, then a same-titled catalogue sibling's topic when that topic exists in this chapter, else the chapter-level **More in this chapter** bucket — the same place the doxxmarks app puts untagged material. Each run also repairs the rows earlier runs committed: every video in that bucket whose catalogue item names a topic the chapter already has is re-filed, and the bucket is dropped once it is empty (the bucket is always appended last, so no other `?topic=<index>` shifts). 756 bucketed videos became 289 re-filed and 467 left — those have no `topic` in the catalogue either, which is why the app buckets them too. Videos already filed under a real topic that the catalogue contradicts are counted in the report and left alone; there were 52. It is a manual step, run when the doxxmarks catalogue moves ahead:

  ```
  node scripts/drive-crawl/sync-doxxmarks-videos.mjs \
    --catalogue /path/to/doxxmarks/public/data [--apply] [--report PATH]
  ```

- `ContentVideoPlayer` in `doxx-watch.tsx` now plays a non-HLS source through the native `<video>` element, so an mp4-only film is a lesson rather than a gap. Hls.js cannot open an mp4, which is why the fallback exists.

After the first sync the catalogue holds 3,654 videos against the doxxmarks app's 3,633 — the extra ones are films this repo files in more than one chapter, and the five that differ are dead (404) media in the doxxmarks catalogue.

### Getting `EXTRAMARKS_TOKEN`

The discovery script authenticates as a teacher, so it needs a short-lived JWT (~60 min) that cannot be minted server-side:

1. Log into the Extramarks teacher app in a browser.
2. In the devtools console: `JSON.parse(localStorage.extramarks_user).access_token`.
3. Run `EXTRAMARKS_TOKEN=... node discover-insta-revision-sources.mjs` from `scripts/drive-crawl/`.

The token is never committed and never enters Actions — re-run discovery only when the folder tree itself changed.

## When a note fails to load

A `403` no longer has a signing explanation, so it points at the bucket: the object is not in the public mirror (only in the private one), or the mirror's path prefix changed. A `404` means the PDF moved. Both are diagnosed from the [Operations-Runbook](Operations-Runbook), not by re-running the pipeline — that only re-derives the same URL from the same path.

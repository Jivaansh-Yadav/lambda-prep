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
                  "revisionNotes": [ { "name", "link" } ],
                  "topics": [ … ]
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
- **Nothing rotates, so nothing has to run weekly.** `update-resources.yml` no longer carries a `schedule:` — it is dispatched by hand (the admin panel's “Update resource datasets” button) only when Drive content actually changed.
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

- **`/doxxmarks`** — `class` (slug), `subject` (display name), `chapter` and `note` are **indices**, not names. A share link therefore looks like `?class=icse-10&subject=Biology&chapter=0&note=0` and stays valid as long as the chapter order is stable. The raw bucket URL is never the share target.
- **`note-pdf-watch.tsx`** — the note viewer. The PDF is embedded as an `<iframe>` pointing straight at the public URL, with an overlay toolbar (open in new tab, copy link, share) positioned top-left so it never sits under the frame's own chrome.
- **`doxx-watch.tsx`** — the lesson player: `@videojs/react` with an HLS source, plus a playlist of the chapter's other lessons.
- **Fullscreen** — the player and the PDF viewer both need fullscreen from inside a framed document. That is why `Permissions-Policy` in `src/server.ts` lists `fullscreen=(self "https://mscontent-gcp.extramarks.com" "https://drive.google.com")` instead of `fullscreen=()`, and why `_headers` carries the same value.
- **Sandboxing** — embedded third-party frames are sandboxed, but PDF viewers need `allow-same-origin` to render at all; removing it produces a blank white frame (this was a real regression, see the Resources section of the runbook).

## CSP consequences

`frame-src` must include:

| Origin | Used for |
| --- | --- |
| `https://drive.google.com` | Drive-hosted PDFs in the resource viewer |
| `https://mscontent-gcp.extramarks.com` | Interactive classes and lesson video |
| `https://storage.googleapis.com` | The public-bucket revision-note PDFs |

Adding a fourth embed origin means editing **both** `CONTENT_SECURITY_POLICY` in `src/server.ts` and `public/_headers`, or the iframe works in dev (where the worker header wins) and breaks behind the static host — or the reverse.

## Regenerating the source list

`discover-insta-revision-sources.mjs` is the manual step that rebuilds `insta-revision-sources.json` when the Doxxmarks folder tree changes (new class, renamed subject, new chapter PDFs). It walks the Drive tree, resolves each chapter's PDF folder path, and writes the committed source list. Run it by hand, review the diff, commit — it is deliberately *not* in the workflow, because a rename in Drive would otherwise silently rewrite the curriculum mapping.

Only discovery needs a login; the apply step reads two local JSON files and nothing else.

### Getting `EXTRAMARKS_TOKEN`

The discovery script authenticates as a teacher, so it needs a short-lived JWT (~60 min) that cannot be minted server-side:

1. Log into the Extramarks teacher app in a browser.
2. In the devtools console: `JSON.parse(localStorage.extramarks_user).access_token`.
3. Run `EXTRAMARKS_TOKEN=... node discover-insta-revision-sources.mjs` from `scripts/drive-crawl/`.

The token is never committed and never enters Actions — re-run discovery only when the folder tree itself changed.

## When a note fails to load

A `403` no longer has a signing explanation, so it points at the bucket: the object is not in the public mirror (only in the private one), or the mirror's path prefix changed. A `404` means the PDF moved. Both are diagnosed from the [Operations-Runbook](Operations-Runbook), not by re-running the pipeline — that only re-derives the same URL from the same path.

#!/usr/bin/env node
// Adds a cover image to every Doxxmarks material in
// src/data/doxxmarks_resources.json, taken from the catalogue the
// `Jivaansh-Yadav/doxxmarks` repo publishes (public/data/<BOARD>/<CLASS>.json).
//
// Extramarks already ships one artwork file per piece of content, and that repo
// has crawled them all: every catalogue item carries a `thumb` on the public
// GCS mirror (`storage.googleapis.com/emnewcontent/...`), so nothing has to be
// generated, signed or expiry-managed here — only joined onto our dataset.
//
// Three passes, because the two crawls key their items differently:
//
//   1. by URL      — interactive classes and activities: our `link` and the
//                    catalogue's `url` are the same Extramarks path.
//   2. by folder   — revision-note PDFs and any missed content: both sides hold
//                    the same `..._dir_V00N/` ownCloud folder id in the path,
//                    even when the file name or depth differs.
//   3. by title    — videos: we store the HLS playlist (`output/newfile-hd.m3u8`)
//                    while the catalogue stores the mp4, so the paths diverge
//                    and the title inside a subject is the only stable join.
//                    Chapter-level titles are tried before subject-level ones.
//
// Not all of that artwork is artwork: Extramarks copies a handful of house
// images (the ICSE digital-library banner, the HOTS banner, a crossword
// screenshot…) into hundreds of content folders, each under its own URL, so the
// paths look unique while the pixels are byte-identical. Two of those cover a
// third of the catalogue. The script therefore drops them two ways — by name
// for the obvious ones, and by content for the rest: every cover it is about to
// write is HEADed, grouped by the `x-goog-hash` GCS reports, and any image that
// would appear twice inside the same topic (or inside the same chapter's notes)
// is discarded. A card with no artwork keeps its category icon tile, which reads
// better than four splash banners in a row.
//
// Usage:
//   node apply-doxx-thumbnails.mjs [--source <dir>] [--repo owner/name]
//                                  [--ref main] [--curriculum <path>]
//                                  [--stock-min n] [--no-probe] [--dry]
//
//   --source     local clone's public/data directory (offline catalogue)
//   --repo       catalogue repo to fetch when --source is not given
//   --stock-min  how many times one image may appear inside a group before it
//                counts as stock art (default 2)
//   --no-probe   skip the stock-art pass (fast, offline, keeps the splashes)
//   --dry        report coverage without writing the dataset

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_REPO = "Jivaansh-Yadav/doxxmarks";
const DEFAULT_REF = "main";

/** Classes we actually render, keyed the way our dataset labels them. The
 * catalogue files are named by Extramarks class roman ("IX", "X", "XI", …). */
const CLASSES = ["IX", "X", "XI", "XII"];

function parseArgs(argv) {
  const args = {
    source: null,
    repo: DEFAULT_REPO,
    ref: DEFAULT_REF,
    curriculum: path.resolve(SCRIPT_DIR, "../../src/data/doxxmarks_resources.json"),
    stockMin: 2,
    probe: true,
    dry: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source") args.source = path.resolve(process.cwd(), argv[++i]);
    else if (argv[i] === "--repo") args.repo = argv[++i];
    else if (argv[i] === "--ref") args.ref = argv[++i];
    else if (argv[i] === "--curriculum") args.curriculum = path.resolve(process.cwd(), argv[++i]);
    else if (argv[i] === "--stock-min") args.stockMin = Number(argv[++i]) || 2;
    else if (argv[i] === "--no-probe") args.probe = false;
    else if (argv[i] === "--dry") args.dry = true;
  }
  return args;
}

/** Extramarks links are occasionally recorded with a query string or a
 * trailing slash; the catalogue's `url` never is. */
export function normalizeUrl(url) {
  return String(url ?? "")
    .split("?")[0]
    .split("#")[0]
    .replace(/^http:\/\//, "https://")
    .replace(/\/+$/, "");
}

/** The ownCloud folder id shared by every rendition of one piece of content:
 *   .../174979908100235224_dir_V001/1/...      newer content
 *   .../school_slm/2017/07/03/1705795/dir_1705795/index.html   older content
 * Extramarks re-renders a lesson into a new dated folder but keeps the id, so
 * this survives the m3u8-vs-mp4 split that defeats URL matching. */
export function folderId(url) {
  const value = normalizeUrl(url);
  const prefixed = value.match(/\/([0-9A-Za-z_]{6,})_dir(?:$|[_/])/);
  if (prefixed) return prefixed[1].toLowerCase();
  const suffixed = value.match(/\/dir_([0-9A-Za-z_]{4,})(?:$|[/.])/);
  if (suffixed) return suffixed[1].toLowerCase();
  return "";
}

/** Lowercased, punctuation-free form used to compare titles and chapter names
 * ("Cell- Unit Of Life" and "Cell: Unit of Life" are the same chapter). */
export function normalizeTitle(title) {
  return String(title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** House art recognisable from the file name alone. The rest of it is caught by
 * content in `stockWithinGroups`, which also throws out the house splashes for
 * kinds where real artwork is one-off (`GLOBALLY_UNIQUE_KINDS`). */
const HOUSE_ART = /(^|\/)(icsedl|imagedl|dlthumbnail|extramarks|extramarks_logo|logo|splash|placeholder|casestudy)[^/]*$/i;

export function isUsableThumb(thumb) {
  const value = String(thumb ?? "").trim();
  if (!value.startsWith("https://")) return false;
  return !HOUSE_ART.test(value);
}

/** Flat index over one board's catalogue files, keyed every way we can join. */
export function buildIndex(classDocs) {
  const index = { byUrl: new Map(), byFolder: new Map(), byChapter: new Map(), bySubject: new Map() };

  for (const doc of classDocs) {
    const roman = String(doc?.class?.name ?? "").trim();
    if (!roman) continue;
    for (const subject of doc.subjects ?? []) {
      const subjectKey = normalizeTitle(subject.name);
      for (const chapter of subject.chapters ?? []) {
        const chapterKey = normalizeTitle(chapter.name);
        for (const item of chapter.items ?? []) {
          if (!isUsableThumb(item.thumb)) continue;

          const url = normalizeUrl(item.url);
          if (url && !index.byUrl.has(`${roman}|${url}`)) index.byUrl.set(`${roman}|${url}`, item.thumb);
          const folder = folderId(item.url);
          if (folder && !index.byFolder.has(`${roman}|${folder}`)) index.byFolder.set(`${roman}|${folder}`, item.thumb);

          const title = normalizeTitle(item.title);
          if (!title) continue;
          // First writer wins: the catalogue often lists the same video under
          // two groups, and either copy carries the same artwork.
          const byChapter = `${roman}|${subjectKey}|${chapterKey}|${title}`;
          if (!index.byChapter.has(byChapter)) index.byChapter.set(byChapter, item.thumb);
          const bySubject = `${roman}|${subjectKey}|${title}`;
          if (!index.bySubject.has(bySubject)) index.bySubject.set(bySubject, item.thumb);
        }
      }
    }
  }

  return index;
}

/** Cover for one material. `unit` supplies the context the title fallback
 * needs: the class roman plus the subject and chapter the item sits in. */
export function resolveThumb(index, link, unit) {
  const url = normalizeUrl(link);
  if (url) {
    const hit = index.byUrl.get(`${unit.roman}|${url}`);
    if (hit) return { thumb: hit, via: "url" };
  }

  const folder = folderId(link);
  if (folder) {
    const hit = index.byFolder.get(`${unit.roman}|${folder}`);
    if (hit) return { thumb: hit, via: "folder" };
  }

  return undefined;
}

function titleLookup(index, unit, title) {
  const key = normalizeTitle(title);
  if (!key) return undefined;
  return (
    index.byChapter.get(`${unit.roman}|${unit.subjectKey}|${unit.chapterKey}|${key}`) ??
    index.bySubject.get(`${unit.roman}|${unit.subjectKey}|${key}`)
  );
}

/** Every material node in the dataset, with the context its lookups need and
 * the group it is shown in: one topic's materials, or one chapter's notes.
 * Covers are judged for repetition inside that group — a topic's cards sit on
 * one page together, so two of them showing the same picture is what reads as
 * broken. */
function* materials(curriculum) {
  for (const [board, boardData] of Object.entries(curriculum.boards ?? {})) {
    for (const [roman, classData] of Object.entries(boardData.classes ?? {})) {
      for (const subject of classData.subjects ?? []) {
        for (const chapter of subject.chapters ?? []) {
          const unit = {
            board,
            roman,
            subjectName: subject.name,
            subjectKey: normalizeTitle(subject.name),
            chapterKey: normalizeTitle(chapter.name),
          };
          const chapterKey = `${roman}|${unit.chapterKey}|${unit.subjectKey}`;
          for (const [topicIdx, topic] of (chapter.topics ?? []).entries()) {
            const group = `${chapterKey}|${topicIdx}`;
            for (const key of ["interactiveClasses", "videoLessons"]) {
              for (const entry of topic[key] ?? []) {
                yield { kind: key, entry, unit, group, title: entry.name, link: entry.link };
              }
            }
            for (const entry of topic.activities ?? []) {
              yield { kind: "activities", entry, unit, group, title: entry.title, link: entry.link };
            }
          }
          for (const entry of chapter.revisionNotes ?? []) {
            yield { kind: "revisionNotes", entry, unit, group: `${chapterKey}|notes`, title: entry.name, link: entry.link };
          }
        }
      }
    }
  }
}

/** Best cover for each material, without touching the dataset yet: the
 * stock-art pass needs to see every match before it can drop the duplicates. */
export function collectMatches(curriculum, index) {
  const matches = [];
  for (const material of materials(curriculum)) {
    const { entry, kind, unit, group } = material;

    const direct = resolveThumb(index, material.link, unit);
    if (direct) {
      matches.push({ entry, kind, group, thumb: direct.thumb, via: direct.via });
      continue;
    }

    // Videos only: the playlist path and the catalogue's mp4 have nothing in
    // common, so the title is the join.
    if (kind === "videoLessons") {
      const thumb = titleLookup(index, unit, material.title);
      if (thumb) matches.push({ entry, kind, group, thumb, via: "title" });
    }
  }
  return matches;
}

/** Kinds judged on a stricter rule than "repeats on one page".
 *
 * An interactive class cover is only ever decorative: when Extramarks ships a
 * real screenshot it is one-off, and everything else is the house splash
 * (orange wordmark, "ICSE HOTS" banner) that they copy into every folder. Those
 * splashes look like an advert inside the card, so for this kind an image is
 * only trusted if no other topic in the class uses it. Measured on the current
 * catalogue that leaves ~5 of 311 joinable covers — the rest fall back to the
 * icon tile, which is the better card. */
const GLOBALLY_UNIQUE_KINDS = new Set(["interactiveClasses"]);

/** Covers that repeat where they should not. `hashes` maps a cover URL to the
 * `x-goog-hash` GCS reports for it; anything unprobed is left alone, because a
 * missing hash is not evidence of stock art.
 *
 * Two rules, by kind:
 * - default — an image may not appear `min` times inside one group (a topic's
 *   cards, or one chapter's notes). A practice-game cover shared by every game
 *   in the class is *relevant* art, so it survives; two identical pictures side
 *   by side on the same page do not.
 * - `GLOBALLY_UNIQUE_KINDS` — the image may not appear in two groups at all,
 *   which is what removes the house splashes. */
export function stockWithinGroups(matches, hashes, min = 2) {
  const inGroup = new Map();
  const acrossKind = new Map();
  for (const match of matches) {
    const hash = hashes.get(match.thumb);
    if (!hash) continue;
    const key = `${match.group}|${hash}`;
    inGroup.set(key, (inGroup.get(key) ?? 0) + 1);
    const kindKey = `${match.kind}|${hash}`;
    const groups = acrossKind.get(kindKey) ?? acrossKind.set(kindKey, new Set()).get(kindKey);
    groups.add(match.group);
  }

  const stock = new Set();
  for (const match of matches) {
    const hash = hashes.get(match.thumb);
    if (!hash) continue;
    const repeated = (inGroup.get(`${match.group}|${hash}`) ?? 0) >= min;
    const shared = GLOBALLY_UNIQUE_KINDS.has(match.kind)
      ? (acrossKind.get(`${match.kind}|${hash}`)?.size ?? 0) > 1
      : false;
    if (repeated || shared) stock.add(match.thumb);
  }
  return stock;
}

export function applyThumbs(curriculum, index, { stock = new Set() } = {}) {
  const stats = { total: 0, matched: 0, byUrl: 0, byFolder: 0, byTitle: 0, stock: 0, byKind: {} };

  // Every material is rewritten from the catalogue on each run, so a cover that
  // is no longer joinable — or has since been recognised as stock art —
  // disappears instead of lingering in the committed dataset.
  for (const { entry, kind } of materials(curriculum)) {
    delete entry.thumb;
    stats.total += 1;
    const bucket = (stats.byKind[kind] ??= { total: 0, matched: 0, byTitle: 0, stock: 0 });
    bucket.total += 1;
  }

  for (const match of collectMatches(curriculum, index)) {
    const bucket = stats.byKind[match.kind];
    if (stock.has(match.thumb)) {
      stats.stock += 1;
      bucket.stock += 1;
      continue;
    }
    match.entry.thumb = match.thumb;
    stats.matched += 1;
    bucket.matched += 1;
    if (match.via === "title") {
      stats.byTitle += 1;
      bucket.byTitle += 1;
    } else {
      stats[match.via === "url" ? "byUrl" : "byFolder"] += 1;
    }
  }

  return stats;
}

/** GCS answers a HEAD with `x-goog-hash: crc32c=…,md5=…`. Comparing those is
 * the only way to tell one splash served from six hundred folders apart from
 * six hundred stills. */
export async function probeHashes(urls, { concurrency = 24, onProgress } = {}) {
  const hashes = new Map();
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < urls.length) {
      const url = urls[next];
      next += 1;
      try {
        const response = await fetch(url, { method: "HEAD" });
        const hash = response.headers.get("x-goog-hash");
        if (response.ok && hash) hashes.set(url, hash.replace(/\s+/g, " ").trim());
      } catch {
        // Unreachable cover: keep it. The card's own onError fallback covers the
        // blind spot, and one bad request must not empty the dataset.
      }
      done += 1;
      if (onProgress && done % 500 === 0) onProgress(done, urls.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return hashes;
}

async function fetchCatalogue({ repo, ref }) {
  const docs = [];
  for (const roman of CLASSES) {
    const url = `https://raw.githubusercontent.com/${repo}/${ref}/public/data/ICSE/${roman}.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    docs.push(await response.json());
  }
  return { docs, label: `${repo}@${ref}/public/data/ICSE` };
}

async function readCatalogue({ source }) {
  const docs = [];
  for (const roman of CLASSES) {
    const file = path.join(source, "ICSE", `${roman}.json`);
    docs.push(JSON.parse(await fs.readFile(file, "utf8")));
  }
  return { docs, label: source };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogue = args.source ? await readCatalogue(args) : await fetchCatalogue(args);
  const index = buildIndex(catalogue.docs);

  const curriculum = JSON.parse(await fs.readFile(args.curriculum, "utf8"));

  let stock = new Set();
  let probeNote = "skipped";
  if (args.probe) {
    const candidates = [...new Set(collectMatches(curriculum, index).map((match) => match.thumb))];
    const hashes = await probeHashes(candidates, {
      onProgress: (done, total) => process.stderr.write(`  hashed ${done}/${total}\n`),
    });
    stock = stockWithinGroups(collectMatches(curriculum, index), hashes, args.stockMin);
    probeNote = `${hashes.size}/${candidates.length} hashed, ${stock.size} stock images dropped`;
  }

  const stats = applyThumbs(curriculum, index, { stock });

  const pct = (n) => `${Math.round((n / Math.max(stats.total, 1)) * 100)}%`;
  console.log(`catalogue: ${catalogue.label}`);
  console.log(`stock art: ${probeNote}`);
  console.log(
    `covers: ${stats.matched}/${stats.total} (${pct(stats.matched)})` +
      ` — url ${stats.byUrl}, folder ${stats.byFolder}, title ${stats.byTitle}, dropped ${stats.stock}`,
  );
  for (const [kind, bucket] of Object.entries(stats.byKind)) {
    const dropped = bucket.stock ? `, ${bucket.stock} stock` : "";
    console.log(`  ${kind.padEnd(19)} ${bucket.matched}/${bucket.total}${dropped}`);
  }

  if (args.dry) {
    console.log("dry run — dataset not written");
    return;
  }

  // The dataset is serialised with a 3-space indent, which round-trips byte for
  // byte, so the commit shows only the added (or removed) `thumb` lines.
  await fs.writeFile(args.curriculum, JSON.stringify(curriculum, null, 3));
  console.log(`wrote ${path.relative(process.cwd(), args.curriculum) || args.curriculum}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

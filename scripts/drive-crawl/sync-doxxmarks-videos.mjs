#!/usr/bin/env node
// Fills the gaps between this repo's Doxxmarks catalogue and the doxxmarks
// app's catalogue: concept videos that exist upstream but never made it into
// src/data/doxxmarks_resources.json.
//
// Why gaps exist. `crawl-curriculum.mjs` only treats a Learn record as a
// lesson when it is (a) HTML in an SLM group, (b) Nucleus *and* Content Group
// CRS, or (c) Animation in CRS for the same subject. Extramarks files plenty
// of films under Nucleus/SLM and Animation/SLM, so those records were never
// collected; and of the ones that were, any whose HLS output directory 404s
// was dropped rather than kept. The doxxmarks app (which reads the direct mp4
// and plays it natively) keeps both, so it lists ~750 videos this catalogue
// never showed.
//
// What this does. Reads a doxxmarks `public/data` tree, walks the same
// board/class/subject/chapter skeleton, and for every video item this
// catalogue lacks:
//
//   * derives the HLS playlist the player actually streams from the mp4's own
//     directory (`<dir>/output/manifest.m3u8`, falling back to the
//     `<name>-hd.m3u8` naming the older builds use), and keeps the mp4 itself
//     when no playlist is published but the file still answers;
//   * drops items whose media is gone (404), rather than adding dead links;
//   * files the item under the topic Extramarks tagged it with, or the topic
//     of the same-titled item this catalogue already has, or — matching what
//     the doxxmarks app does with untagged material — a chapter-level
//     "More in this chapter" bucket.
//
// Usage:
//   node scripts/drive-crawl/sync-doxxmarks-videos.mjs \
//     --catalogue /path/to/doxxmarks/public/data [--apply] [--report PATH]
//
// Without --apply it reports what it would add and touches nothing.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The doxxmarks catalogue is one board/class file per class; this repo splits
 * the senior classes onto the ISC board, so the two names don't line up. */
const CLASS_FILES = [
  { board: "ICSE", roman: "IX", file: "ICSE/IX.json" },
  { board: "ICSE", roman: "X", file: "ICSE/X.json" },
  { board: "ISC", roman: "XI", file: "ICSE/XI.json" },
  { board: "ISC", roman: "XII", file: "ICSE/XII.json" },
];

/** Chapter-level bucket for material Extramarks never tagged to a topic —
 * the equivalent of the doxxmarks app's "More in this chapter" shelf. */
const UNTAGGED_TOPIC = "More in this chapter";

const CONCURRENCY = 8;

function parseArgs(argv) {
  const args = {
    catalogue: null,
    apply: false,
    report: null,
    curriculum: path.resolve(SCRIPT_DIR, "../../src/data/doxxmarks_resources.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--apply") args.apply = true;
    else if (flag === "--catalogue") args.catalogue = path.resolve(process.cwd(), argv[++i]);
    else if (flag === "--report") args.report = path.resolve(process.cwd(), argv[++i]);
    else if (flag === "--curriculum") args.curriculum = path.resolve(process.cwd(), argv[++i]);
    else if (flag === "--help") {
      console.log(
        "Usage: sync-doxxmarks-videos.mjs --catalogue <doxxmarks/public/data> [--apply] [--report PATH] [--curriculum PATH]",
      );
      process.exit(0);
    }
  }
  if (!args.catalogue) {
    console.error("--catalogue <doxxmarks/public/data> is required");
    process.exit(1);
  }
  return args;
}

/** Titles are the only stable key across the two catalogs: ids differ, and the
 * mp4 and m3u8 URLs for the same film share nothing but their folder. */
export function normalizeTitle(name) {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isVideoItem(item) {
  if (item?.family === "video") return true;
  const url = item?.video ?? item?.url ?? "";
  return /\.(mp4|m3u8|webm)(\?|$)/i.test(url);
}

async function exists(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-256", "User-Agent": "lambda-prep-catalogue-sync" },
        signal: AbortSignal.timeout(20_000),
      });
      await response.body?.cancel();
      if (response.ok) return true;
      if (response.status !== 429 && response.status < 500) return false;
    } catch {
      // network hiccup: retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return false;
}

/**
 * The player streams HLS only, so prefer the playlist Extramarks renders next
 * to every mp4. Two layouts exist:
 *   <dir>/output/manifest.m3u8          (master playlist, most content)
 *   <dir>/output/<name>-hd.m3u8         (older single-rendition builds)
 * When neither is published the mp4 itself is still playable, and the watch
 * view falls back to a native <video> for it.
 */
async function resolveMedia(mediaUrl) {
  if (!mediaUrl) return null;
  const cut = mediaUrl.lastIndexOf("/");
  const directory = mediaUrl.slice(0, cut);
  const file = mediaUrl.slice(cut + 1);
  const stem = file.replace(/\.mp4$/i, "");

  const manifest = `${directory}/output/manifest.m3u8`;
  if (await exists(manifest)) return { link: manifest, kind: "hls" };

  const guessed = `${directory}/output/${stem}-hd.m3u8`;
  if (await exists(guessed)) return { link: guessed, kind: "hls" };

  if (await exists(mediaUrl)) return { link: mediaUrl, kind: "mp4" };
  return null;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Topic the item belongs under, in this catalogue's shape.
 *
 * The catalogue's top-level `topic` is the syllabus node Extramarks filed the
 * item under, and it is the field the doxxmarks app groups by. `meta.Topic` is
 * only stamped on some record families (HTML/SLM) and goes stale, so it is a
 * fallback: Nucleus films carry nothing there, which is how 756 videos ended
 * up in the chapter-level bucket instead of their real topic.
 */
export function chooseTopic(chapter, item, topicByKey, topicByTitle, remoteTopicByTitle) {
  const tagged =
    topicByKey.get(normalizeTitle(item?.topic)) ??
    topicByKey.get(normalizeTitle(item?.meta?.Topic));
  if (tagged) return tagged;

  const byTitle = topicByTitle.get(normalizeTitle(item.title));
  if (byTitle) return byTitle;

  // Same-title sibling in the catalogue, filed under a topic that exists here:
  // the item's own tag is empty, so its siblings are the best evidence left.
  const sibling = topicByKey.get(normalizeTitle(remoteTopicByTitle?.get(normalizeTitle(item.title))));
  if (sibling) return sibling;

  let bucket = chapter.topics.find((topic) => topic.name === UNTAGGED_TOPIC);
  if (!bucket) {
    bucket = { name: UNTAGGED_TOPIC, interactiveClasses: [], videoLessons: [], activities: [] };
    chapter.topics.push(bucket);
  }
  return bucket;
}

/**
 * Re-files videos that already sit in the chapter-level bucket onto the topic
 * the catalogue names, and drops the bucket once it holds nothing.
 *
 * The bucket is where chooseTopic puts items with no usable tag, so every
 * entry in it is a placement that was guessed by *absence*. When the catalogue
 * does name a topic that exists in this chapter, that is strictly better
 * information — the fix has to reach the rows already committed, since the
 * sync skips titles it already has.
 */
export function repairBucketedTopics(chapter, remoteTopicByTitle) {
  const bucket = chapter.topics.find((topic) => topic.name === UNTAGGED_TOPIC);
  if (!bucket || !remoteTopicByTitle?.size) return { moved: 0, left: 0, dropped: false };

  const topicByKey = new Map(chapter.topics.map((topic) => [normalizeTitle(topic.name), topic]));
  const keep = [];
  let moved = 0;
  for (const video of bucket.videoLessons ?? []) {
    const target = topicByKey.get(normalizeTitle(remoteTopicByTitle.get(normalizeTitle(video.name))));
    if (target && target !== bucket) {
      target.videoLessons ??= [];
      target.videoLessons.push(video);
      moved += 1;
    } else {
      keep.push(video);
    }
  }
  bucket.videoLessons = keep;

  const dropped =
    keep.length === 0 &&
    (bucket.interactiveClasses ?? []).length === 0 &&
    (bucket.activities ?? []).length === 0;
  if (dropped) chapter.topics = chapter.topics.filter((topic) => topic !== bucket);

  return { moved, left: keep.length, dropped };
}

export function indexTopics(chapter) {
  const topicByKey = new Map();
  const topicByTitle = new Map();
  for (const topic of chapter.topics) {
    topicByKey.set(normalizeTitle(topic.name), topic);
    for (const entry of [
      ...(topic.videoLessons ?? []),
      ...(topic.interactiveClasses ?? []),
      ...(topic.activities ?? []),
    ]) {
      const title = entry.name ?? entry.title;
      if (title) topicByTitle.set(normalizeTitle(title), topic);
    }
    // topicByTitle is a lookup aid only; a real topic name always wins.
  }
  for (const topic of chapter.topics) topicByKey.set(normalizeTitle(topic.name), topic);
  return { topicByKey, topicByTitle };
}

/** title → syllabus node, for one catalogue chapter. */
export function indexRemoteTopics(remoteChapter) {
  const map = new Map();
  for (const item of remoteChapter?.items ?? []) {
    const title = normalizeTitle(item?.title);
    const topic = (item?.topic ?? "").trim();
    if (title && topic) map.set(title, topic);
  }
  return map;
}

/**
 * Videos that are already filed under a real topic which the catalogue
 * contradicts. Reported, never moved: a stale `meta.Topic` and a deliberate
 * placement look identical from here, and the bucket repair is the only class
 * of mistake this script can prove.
 */
export function findTopicMismatches(chapter, remoteTopicByTitle) {
  if (!remoteTopicByTitle?.size) return [];
  const topicByKey = new Map(chapter.topics.map((topic) => [normalizeTitle(topic.name), topic]));
  const mismatched = [];
  for (const topic of chapter.topics) {
    if (topic.name === UNTAGGED_TOPIC) continue;
    for (const video of topic.videoLessons ?? []) {
      const remote = topicByKey.get(normalizeTitle(remoteTopicByTitle.get(normalizeTitle(video.name))));
      if (remote && remote !== topic) {
        mismatched.push({ title: video.name, filedUnder: topic.name, catalogueNames: remote.name });
      }
    }
  }
  return mismatched;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const curriculum = JSON.parse(await fs.readFile(args.curriculum, "utf8"));

  const report = { added: [], dead: [], repaired: [], mismatched: [], classes: [] };

  for (const spec of CLASS_FILES) {
    const classData = curriculum.boards?.[spec.board]?.classes?.[spec.roman];
    if (!classData) continue;

    let catalogue;
    try {
      catalogue = JSON.parse(await fs.readFile(path.join(args.catalogue, spec.file), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        console.warn(`skip ${spec.board} ${spec.roman}: ${spec.file} not in the catalogue`);
        continue;
      }
      throw error;
    }
    const catalogueSubjects = new Map(
      (catalogue.subjects ?? []).map((subject) => [subject.name, subject]),
    );

    // Collect the candidates first so the (slow) network probes run in
    // parallel rather than inside the tree walk.
    const candidates = [];
    const matched = [];
    for (const subject of classData.subjects ?? []) {
      const remote = catalogueSubjects.get(subject.name);
      if (!remote) continue;
      const remoteChapters = new Map((remote.chapters ?? []).map((c) => [c.name, c]));
      for (const chapter of subject.chapters ?? []) {
        const remoteChapter = remoteChapters.get(chapter.name);
        if (!remoteChapter) continue;
        matched.push({ subject, chapter, remoteChapter });
        const known = new Set();
        for (const topic of chapter.topics ?? []) {
          for (const video of topic.videoLessons ?? []) known.add(normalizeTitle(video.name));
        }
        for (const item of remoteChapter.items ?? []) {
          if (!isVideoItem(item)) continue;
          if (known.has(normalizeTitle(item.title))) continue;
          known.add(normalizeTitle(item.title));
          candidates.push({ subject, chapter, item });
        }
      }
    }

    const remoteTopicsByChapter = new Map(
      matched.map(({ chapter, remoteChapter }) => [chapter, indexRemoteTopics(remoteChapter)]),
    );

    const resolved = await mapLimit(candidates, CONCURRENCY, async (candidate) => ({
      ...candidate,
      media: await resolveMedia(candidate.item.video ?? candidate.item.url),
    }));

    let addedHere = 0;
    for (const { subject, chapter, item, media } of resolved) {
      const label = `${spec.board} ${spec.roman} · ${subject.name} · ${chapter.name} · ${item.title}`;
      if (!media) {
        report.dead.push(label);
        continue;
      }
      const { topicByKey, topicByTitle } = indexTopics(chapter);
      const topic = chooseTopic(
        chapter,
        item,
        topicByKey,
        topicByTitle,
        remoteTopicsByChapter.get(chapter),
      );
      topic.videoLessons ??= [];
      topic.videoLessons.push({
        name: item.title,
        link: media.link,
        ...(item.thumb ? { thumb: item.thumb } : {}),
      });
      report.added.push({ label, kind: media.kind });
      addedHere += 1;
    }

    // The fix has to reach rows the previous runs already committed: those
    // were placed by absence of a tag, not by a real one.
    let repairedHere = 0;
    for (const { subject, chapter } of matched) {
      const remoteTopicByTitle = remoteTopicsByChapter.get(chapter);
      const label = `${spec.board} ${spec.roman} · ${subject.name} · ${chapter.name}`;
      const { moved, left, dropped } = repairBucketedTopics(chapter, remoteTopicByTitle);
      if (moved > 0) {
        repairedHere += moved;
        report.repaired.push({ label, moved, left, dropped });
      }
      for (const mismatch of findTopicMismatches(chapter, remoteTopicByTitle)) {
        report.mismatched.push({ label, ...mismatch });
      }
    }

    report.classes.push({
      class: `${spec.board} ${spec.roman}`,
      candidates: candidates.length,
      added: addedHere,
      repaired: repairedHere,
      dead: candidates.length - addedHere,
    });
    console.log(
      `${spec.board} ${spec.roman}: ${addedHere} video(s) added, ${repairedHere} re-filed from the bucket, ` +
        `${candidates.length - addedHere} unreachable`,
    );
  }

  const streamed = report.added.filter((entry) => entry.kind === "hls").length;
  const native = report.added.length - streamed;
  console.log(
    `\nTotal: ${report.added.length} added (${streamed} HLS, ${native} direct mp4), ` +
      `${report.dead.length} skipped because the media 404s`,
  );
  console.log(
    `Re-filed: ${report.repaired.reduce((sum, entry) => sum + entry.moved, 0)} video(s) out of the ` +
      `chapter-level bucket across ${report.repaired.length} chapter(s)`,
  );
  if (report.mismatched.length > 0) {
    console.log(
      `Note: ${report.mismatched.length} already-filed video(s) sit under a different topic than the ` +
        `catalogue names — left untouched, listed in the report`,
    );
  }

  if (args.apply) {
    await fs.writeFile(args.curriculum, JSON.stringify(curriculum, null, 3));
    console.log(`Wrote ${args.curriculum}`);
  } else {
    console.log("Dry run — nothing written. Re-run with --apply.");
  }

  if (args.report) {
    await fs.writeFile(args.report, JSON.stringify(report, null, 2));
    console.log(`Report: ${args.report}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error("Fatal:", error);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// Folds the InstaRevision revision-note PDFs listed in
// src/data/insta-revision-sources.json into the chapter-level
// `revisionNotes` arrays of src/data/doxxmarks_resources.json.
//
// Since the notes moved to the public GCS bucket, a note URL is a pure
// function of its folder path — no signing, no credentials, no network, no
// expiry:
//
//   gs://em_content_private/<path>  ->  <PUBLIC_NOTE_BASE><path>
//
// `gs://emnewcontent` mirrors the private bucket's object layout under a
// `beta/` prefix, so `<path>` is exactly the folderPath already recorded in
// the sources file. The URLs are therefore stable for as long as the object
// stays in the bucket, and a missed pipeline run can no longer rot them.
//
// Matching key: (board, class roman, subject name, normalized chapter name).
// insta-revision-sources.json classLabels look like "ICSE - X" / "ISC - XI".
//
// Usage:
//   node apply-insta-revision-notes.mjs
//     [--sources ../../src/data/insta-revision-sources.json]
//     [--curriculum ../../src/data/doxxmarks_resources.json]

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Public read-through of the private content bucket: same object paths,
 * under a `beta/` prefix. No expiry, so no re-signing step anywhere. */
const PUBLIC_NOTE_BASE = "https://storage.googleapis.com/emnewcontent/beta/";

const CLASS_LABEL_TO_BOARD_ROMAN = {
  "icse - ix": ["ICSE", "IX"],
  "icse - x": ["ICSE", "X"],
  "isc - xi": ["ISC", "XI"],
  "isc - xii": ["ISC", "XII"],
};

function parseArgs(argv) {
  const args = {
    sources: path.resolve(SCRIPT_DIR, "../../src/data/insta-revision-sources.json"),
    curriculum: path.resolve(SCRIPT_DIR, "../../src/data/doxxmarks_resources.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--sources") args.sources = path.resolve(process.cwd(), argv[++i]);
    else if (argv[i] === "--curriculum") args.curriculum = path.resolve(process.cwd(), argv[++i]);
  }
  return args;
}

/** Public URL for a bucket object path. `encodeURI` leaves the slashes alone
 * and escapes the few characters the service-account uploader may have left
 * unescaped in a file name. */
function publicNoteUrl(folderPath) {
  return encodeURI(PUBLIC_NOTE_BASE + folderPath.replace(/^\/+/, ""));
}

/** Loosely normalize a chapter name for fuzzy matching against Extramarks
 * titles, which don't always agree with the curriculum's chapter name on
 * singular/plural or punctuation (e.g. "Refraction of Light at Plane
 * Surface" vs "...Plane Surfaces"). Lowercases, strips punctuation,
 * collapses whitespace, and strips a single trailing 's' from each word
 * (crude singularization) so minor singular/plural drift still matches. */
function normalizeChapterKey(name) {
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const singularized = words.map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  return singularized.join(" ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = JSON.parse(await fs.readFile(args.sources, "utf8"));
  const curriculum = JSON.parse(await fs.readFile(args.curriculum, "utf8"));

  // (board, roman, subjectName, normalizedChapterKey) -> [{name, link}]
  const notesByKey = new Map();
  let sourceNotes = 0;
  for (const [classLabel, subjects] of Object.entries(sources.classes ?? {})) {
    const boardRoman = CLASS_LABEL_TO_BOARD_ROMAN[classLabel.trim().toLowerCase()];
    if (!boardRoman) continue;
    const [board, roman] = boardRoman;
    for (const [subjectName, chapters] of Object.entries(subjects)) {
      for (const [chapterName, notes] of Object.entries(chapters)) {
        const key = `${board}|${roman}|${subjectName.trim()}|${normalizeChapterKey(chapterName)}`;
        const entries = notes
          .filter((note) => note?.folderPath)
          .map((note) => ({
            name: note.title || chapterName,
            link: publicNoteUrl(note.folderPath),
          }));
        if (!entries.length) continue;
        sourceNotes += entries.length;
        notesByKey.set(key, (notesByKey.get(key) ?? []).concat(entries));
      }
    }
  }

  let updated = 0;
  for (const [board, boardData] of Object.entries(curriculum.boards ?? {})) {
    for (const [roman, classData] of Object.entries(boardData.classes ?? {})) {
      for (const subject of classData.subjects ?? []) {
        for (const chapter of subject.chapters ?? []) {
          const key = `${board}|${roman}|${(subject.name ?? "").trim()}|${normalizeChapterKey(chapter.name ?? "")}`;
          const notes = notesByKey.get(key);
          if (notes && notes.length) {
            chapter.revisionNotes = notes;
            updated += 1;
          }
        }
      }
    }
  }

  // Pretty-printed (3-space indent) to match the hand-formatted style the
  // file was last saved in -- keeps future diffs readable instead of
  // collapsing back to one compact line.
  await fs.writeFile(args.curriculum, JSON.stringify(curriculum, null, 3));
  console.log(
    `Wrote public revision-note links for ${updated} chapter(s) ` +
      `(${sourceNotes} note(s) in ${args.sources}) into ${args.curriculum}`,
  );
  if (updated !== sourceNotes) {
    console.warn(
      `Warning: ${sourceNotes - updated} note(s) did not match a chapter — check the ` +
        `class/subject/chapter labels in ${args.sources}.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});

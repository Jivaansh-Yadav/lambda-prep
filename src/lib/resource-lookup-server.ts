// resource-lookup-server.ts
//
// Server-only helper that resolves a Drive file id (as stored in
// resource_ratings/resource_feedback/resource_views/resource_shares) back
// to a human-readable file name + class label, for the admin "Resource
// stats" panel. Those tables only ever stored the bare Drive file id —
// fine for the app's own per-file lookups (always scoped to one file at a
// time) but not admin-friendly on its own: an id tells a reviewer nothing
// about which file or class it is without manually resolving the Drive
// link.
//
// Builds one in-memory index (file id -> { name, classLabel }) by walking
// every indexed resources dataset (both sources, every class) plus
// Doxxmarks' doxxmarks_resources.json revisionNotes — the same two data sources
// the public Resources/Doxxmarks pages themselves read from — and caches
// it in module scope, since the dataset only changes when the app is
// redeployed (e.g. after an "Update resource datasets" run), not between
// requests within the same server instance.
import { classes } from "./lambda-prep";
import {
  flattenFolderFiles,
  hasResourceDataset,
  loadResourceManifest,
  loadResourceMisc,
  loadResourceSubject,
} from "./resources-data";
import { curriculumClasses } from "./curriculum";

export type FileLocation = {
  name: string;
  classLabel: string;
  /** Slug of the class the file was indexed under ("icse-10"). Null for a
   * Doxxmarks note, whose class is resolved from the curriculum instead. */
  classSlug: string | null;
  /** Display name of the subject, or null when the folder carries none. */
  subject: string | null;
  /** Which collection the file came from; null for Doxxmarks notes. */
  source: "cisce" | "community" | null;
};

let indexPromise: Promise<Map<string, FileLocation>> | null = null;

function classLabel(board: string, grade: string): string {
  return `${board} Class ${grade}`;
}

/** Extracts the Drive file id from a `.../file/d/<id>/view`-style link
 * (the shape every revisionNotes entry in doxxmarks_resources.json uses). */
function driveIdFromLink(link: string): string | null {
  const match = /\/file\/d\/([^/]+)/.exec(link);
  return match?.[1] ?? null;
}

async function buildIndex(): Promise<Map<string, FileLocation>> {
  const index = new Map<string, FileLocation>();

  for (const source of ["cisce", "community"] as const) {
    for (const cls of classes) {
      if (!hasResourceDataset(source, cls.slug)) continue;
      const label = classLabel(cls.board, cls.grade);
      const manifest = await loadResourceManifest(source, cls.slug);
      if (!manifest) continue;

      for (const { subject } of manifest.subjects) {
        const entry = await loadResourceSubject(source, cls.slug, subject);
        if (!entry) continue;
        const location = { classLabel: label, classSlug: cls.slug, subject, source };
        for (const item of entry.items) index.set(item.id, { name: item.name, ...location });
        for (const folder of entry.editorFolders ?? []) {
          for (const item of flattenFolderFiles(folder)) index.set(item.id, { name: item.name, ...location });
        }
      }
      if (manifest.miscCount > 0) {
        const misc = await loadResourceMisc(source, cls.slug);
        for (const item of misc) {
          index.set(item.id, { name: item.name, classLabel: label, classSlug: cls.slug, subject: null, source });
        }
      }
    }
  }

  // Doxxmarks InstaRevision chapter notes: doxxmarks_resources.json stores plain
  // {name, link} entries per chapter, not ResourceItems, so resolve the
  // file id out of the Drive link and use the chapter (+ subject) name as
  // the display name — a generic "InstaRevision Notes" label (what the
  // viewer-facing page shows) would tell an admin nothing useful.
  for (const curriculumClass of curriculumClasses) {
    const classMeta = classes.find((c) => c.board === curriculumClass.board && c.roman === curriculumClass.roman);
    const label = classMeta ? classLabel(classMeta.board, classMeta.grade) : `${curriculumClass.board} Class ${curriculumClass.roman}`;
    for (const subject of curriculumClass.subjects) {
      for (const chapter of subject.chapters) {
        for (const note of chapter.revisionNotes ?? []) {
          const id = driveIdFromLink(note.link);
          if (!id) continue;
          index.set(id, {
            name: `${chapter.name} — ${subject.name}`,
            classLabel: label,
            classSlug: classMeta?.slug ?? null,
            subject: subject.name,
            source: null,
          });
        }
      }
    }
  }

  return index;
}

/** Returns the cached file-id -> {name, classLabel} index, building it on
 * first use. */
function getIndex(): Promise<Map<string, FileLocation>> {
  if (!indexPromise) indexPromise = buildIndex();
  return indexPromise;
}

/** Resolves a single Drive file id to its display name + class label, if
 * it's found in any indexed dataset. Returns a clearly-labeled fallback
 * (rather than throwing or returning undefined) when the id predates the
 * dataset, or was removed from Drive since the last crawl — a stats row
 * should always render something, even for an orphaned id. */
export async function resolveFileLocation(fileId: string): Promise<FileLocation> {
  const index = await getIndex();
  return (
    index.get(fileId) ?? {
      name: "Unknown file",
      classLabel: "Unknown class",
      classSlug: null,
      subject: null,
      source: null,
    }
  );
}

/** Canonical provenance for a file id, or null when the id is not in any
 * indexed dataset. Write endpoints use this instead of trusting the
 * client's class/subject/name — those columns are rendered publicly in the
 * Trending list, so they must come from the catalogue (GH issue #1). */
export async function resolveFileMetadata(fileId: string): Promise<FileLocation | null> {
  const index = await getIndex();
  return index.get(fileId) ?? null;
}

/** Batch form of resolveFileLocation — builds the index once and resolves
 * every id against it, instead of one index build per id. */
export async function resolveFileLocations(fileIds: readonly string[]): Promise<Map<string, FileLocation>> {
  const index = await getIndex();
  const out = new Map<string, FileLocation>();
  for (const id of fileIds) {
    out.set(
      id,
      index.get(id) ?? {
        name: "Unknown file",
        classLabel: "Unknown class",
        classSlug: null,
        subject: null,
        source: null,
      }
    );
  }
  return out;
}

/** Whether `fileId` corresponds to a real, indexed resource file (a
 * crawled Drive file or a Doxxmarks InstaRevision note) — i.e. something
 * that actually appears somewhere on the public Resources/Doxxmarks
 * pages. Used to reject ratings/feedback for made-up ids before they're
 * ever written to the database (GH issue #6). */
export async function isKnownFileId(fileId: string): Promise<boolean> {
  const index = await getIndex();
  return index.has(fileId);
}

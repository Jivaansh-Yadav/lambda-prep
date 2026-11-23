// resource-lookup-server.ts
//
// Server-only helper that resolves a Drive file id (as stored in
// resource_ratings/resource_comments/resource_views/resource_shares) back
// to a human-readable file name + class label, for the admin "Resource
// stats" panel. Those tables only ever stored the bare Drive file id —
// fine for the app's own per-file lookups (always scoped to one file at a
// time) but not admin-friendly on its own: an id tells a reviewer nothing
// about which file or class it is without manually resolving the Drive
// link.
//
// Builds one in-memory index (file id -> { name, classLabel }) by walking
// every indexed resources dataset (both sources, every class) — the same data
// sources the public Resources pages themselves read from — and caches
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

export type FileLocation = {
  name: string;
  classLabel: string;
  /** Slug of the class the file was indexed under ("icse-10"), or null when
   * the id is not in any dataset (an orphaned counter row). */
  classSlug: string | null;
  /** Display name of the subject, or null when the folder carries none. */
  subject: string | null;
  /** Which collection the file came from; null when the id is unknown. */
  source: "cisce" | "community" | null;
};

let indexPromise: Promise<Map<string, FileLocation>> | null = null;

function classLabel(board: string, grade: string): string {
  return `${board} Class ${grade}`;
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
 * crawled Drive file) — i.e. something that actually appears somewhere on
 * the public Resources pages. Used to reject ratings/comments for made-up
 * ids before they're ever written to the database (GH issue #6). */
export async function isKnownFileId(fileId: string): Promise<boolean> {
  const index = await getIndex();
  return index.has(fileId);
}

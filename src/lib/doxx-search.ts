import { curriculumClasses, type Chapter, type CurriculumClass } from '@/lib/curriculum';
import { classes } from '@/lib/lambda-prep';

/**
 * One flat index of everything Doxxmarks can open.
 *
 * The page only ever searched the level it was showing — subjects on a class
 * page, chapters on a subject page — so "where is that refraction video?"
 * meant drilling down by hand and hoping (GH #16). Each entry carries the
 * exact `?class=&subject=&chapter=&topic=&lesson=` (or `&note=`) target, so a
 * result link reopens the same lesson/note the page would have opened.
 */

export type DoxxResultKind =
  | 'class'
  | 'subject'
  | 'chapter'
  | 'topic'
  | 'video'
  | 'interactive'
  | 'activity'
  | 'note';

/** The subset of the /doxxmarks search params a result can point at. */
export interface DoxxSearchTarget {
  class: string;
  subject?: string;
  chapter?: number;
  topic?: number;
  lesson?: number;
  note?: number;
}

export interface DoxxSearchEntry {
  /** Stable React key, built from the drill-down path. */
  id: string;
  kind: DoxxResultKind;
  title: string;
  /** "Physics · ICSE Class 10", shown under the title for orientation. */
  context: string;
  target: DoxxSearchTarget;
}

/** Keys Fuse matches on. Title carries the name; context lets "class 10
 * physics" match a chapter whose own name says neither. The title is weighted
 * double so a chapter called "Light" outranks a lesson that merely mentions it. */
export const DOXX_SEARCH_KEYS = [
  { name: 'title', weight: 2 },
  { name: 'context', weight: 1 },
] as const;

/**
 * 8,800+ entries with long context strings: at Fuse's default 0.35 threshold
 * almost every row matches almost every query ("refraction" returned 594
 * results, 46 of which contained the word). 0.15 tracks literal matches and
 * still tolerates a typo or two.
 */
export const DOXX_SEARCH_OPTIONS = { threshold: 0.15 } as const;

/**
 * Builds the index from the curriculum, mapping each board/roman pair onto the
 * app's class slug (the same lookup the class grid does). Classes the app does
 * not list are skipped — their links would have no slug to navigate to.
 */
export function buildDoxxIndex(
  curriculum: readonly CurriculumClass[] = curriculumClasses,
  classList: ReadonlyArray<{ slug: string; board: string; roman: string }> = classes,
): DoxxSearchEntry[] {
  const entries: DoxxSearchEntry[] = [];

  for (const current of curriculum) {
    const meta = classList.find((c) => c.board === current.board && c.roman === current.roman);
    if (!meta) continue;
    const classLabel = `${current.board} Class ${current.roman}`;
    const classTarget: DoxxSearchTarget = { class: meta.slug };

    entries.push({
      id: `${meta.slug}`,
      kind: 'class',
      title: classLabel,
      context: `${current.subjects.length} ${current.subjects.length === 1 ? 'subject' : 'subjects'}`,
      target: classTarget,
    });

    for (const subject of current.subjects) {
      const subjectTarget: DoxxSearchTarget = { ...classTarget, subject: subject.name };
      entries.push({
        id: `${meta.slug}|${subject.name}`,
        kind: 'subject',
        title: subject.name,
        context: classLabel,
        target: subjectTarget,
      });

      subject.chapters.forEach((chapter: Chapter, chapterIndex: number) => {
        const chapterTarget: DoxxSearchTarget = { ...subjectTarget, chapter: chapterIndex };
        entries.push({
          id: `${meta.slug}|${subject.name}|${chapterIndex}`,
          kind: 'chapter',
          title: chapter.name,
          context: `${subject.name} · ${classLabel}`,
          target: chapterTarget,
        });

        // Chapter notes belong to the chapter, not to a topic, so they are
        // indexed once — right after the chapter they open from.
        (chapter.revisionNotes ?? []).forEach((note, noteIndex) => {
          entries.push({
            id: `${meta.slug}|${subject.name}|${chapterIndex}|note:${noteIndex}`,
            kind: 'note',
            title: note.name,
            context: `${chapter.name} · ${subject.name}`,
            target: { ...chapterTarget, note: noteIndex },
          });
        });

        chapter.topics.forEach((topic, topicIndex) => {
          const topicTarget: DoxxSearchTarget = { ...chapterTarget, topic: topicIndex };
          entries.push({
            id: `${meta.slug}|${subject.name}|${chapterIndex}|${topicIndex}`,
            kind: 'topic',
            title: topic.name,
            context: `${chapter.name} · ${subject.name}`,
            target: topicTarget,
          });

          // Index order must match Doxxmarks' `combinedLessons`: interactive
          // classes, then videos, then activities — `?lesson=` is a position
          // in that array, not a per-list index.
          const lessonContext = `${topic.name} · ${chapter.name}`;
          let lessonIndex = 0;
          for (const lesson of topic.interactiveClasses) {
            entries.push({
              id: `${meta.slug}|${subject.name}|${chapterIndex}|${topicIndex}|lesson:${lessonIndex}`,
              kind: 'interactive',
              title: lesson.name,
              context: lessonContext,
              target: { ...topicTarget, lesson: lessonIndex },
            });
            lessonIndex += 1;
          }
          for (const video of topic.videoLessons) {
            entries.push({
              id: `${meta.slug}|${subject.name}|${chapterIndex}|${topicIndex}|lesson:${lessonIndex}`,
              kind: 'video',
              title: video.name,
              context: lessonContext,
              target: { ...topicTarget, lesson: lessonIndex },
            });
            lessonIndex += 1;
          }
          for (const activity of topic.activities) {
            entries.push({
              id: `${meta.slug}|${subject.name}|${chapterIndex}|${topicIndex}|lesson:${lessonIndex}`,
              kind: 'activity',
              title: activity.title,
              context: lessonContext,
              target: { ...topicTarget, lesson: lessonIndex },
            });
            lessonIndex += 1;
          }
        });
      });
    }
  }

  return entries;
}

/** Built once — the curriculum is static data bundled with the app. */
export const DOXX_INDEX: DoxxSearchEntry[] = buildDoxxIndex();

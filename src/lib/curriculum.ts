import raw from '@/data/doxxmarks_resources.json';

export interface LessonLink {
  name: string;
  link: string;
  /** Cover art Extramarks publishes for this material, on the public GCS
   * mirror — joined in by scripts/drive-crawl/apply-doxx-thumbnails.mjs.
   * Missing for the ~1 in 5 items whose only artwork is a house splash. */
  thumb?: string;
}
/** A non-video, non-class activity node (practice game, virtual lab, HOTS
 * case study, …) crawled from Extramarks alongside the topic's lessons.
 * `type` is the Extramarks content group and doubles as the label shown on
 * the card; the crawler records `status` for the ones it HTTP-checked. */
export interface TopicActivity { type: string; title: string; link: string; thumb?: string; status?: string; note?: string; }
export interface Topic { name: string; interactiveClasses: LessonLink[]; videoLessons: LessonLink[]; activities: TopicActivity[]; }
export interface Chapter { name: string; revisionNotes?: LessonLink[]; topics: Topic[]; }
export interface CurriculumSubject { name: string; chapters: Chapter[]; }
export interface CurriculumClass { board: string; roman: string; subjects: CurriculumSubject[]; }

export interface RawData { boards: Record<string, { classes: Record<string, { subjects: CurriculumSubject[] }> }> }

const data = raw as unknown as RawData;

const named = <T extends { name: string }>(items: T[] | undefined): T[] =>
  (items ?? []).filter(item => item.name.trim().length > 0);

const withLinks = <T extends LessonLink>(items: T[] | undefined): T[] =>
  named(items).filter(item => item.link.trim().length > 0);

/** Activities are rendered as clickable cards that open in the embedded
 * frame, so an entry without a link (or one the crawler marked `BROKEN`) is
 * dropped instead of showing up as a dead card. Duplicate links within a
 * topic — the same game often hangs off two syllabus nodes — collapse to
 * one card. */
const withActivities = (items: TopicActivity[] | undefined): TopicActivity[] => {
  const seen = new Set<string>();
  return (items ?? []).flatMap((item): TopicActivity[] => {
    const title = item?.title?.trim() ?? '';
    const link = item?.link?.trim() ?? '';
    if (!title || !link || item.status === 'BROKEN' || seen.has(link)) return [];
    seen.add(link);
    return [{ type: item.type?.trim() ?? '', title, link, ...(item.thumb ? { thumb: item.thumb } : {}), ...(item.status ? { status: item.status } : {}) }];
  });
};

/** True when a chapter has at least one thing a visitor can open — a lesson,
 * an activity or a revision note. Used to drop subjects that exist in the
 * source data with no published material behind them. */
export function hasChapterContent(chapter: Chapter): boolean {
  return (
    (chapter.revisionNotes?.length ?? 0) > 0 ||
    (chapter.topics ?? []).some(
      topic =>
        (topic.interactiveClasses?.length ?? 0) > 0 ||
        (topic.videoLessons?.length ?? 0) > 0 ||
        (topic.activities?.length ?? 0) > 0,
    )
  );
}

export const curriculumClasses: CurriculumClass[] = buildCurriculumClasses(data);

/** Turns the crawled dataset into render-ready classes: unnamed entries and
 * linkless lessons dropped, duplicate activity links collapsed, and subjects
 * that published nothing removed. */
export function buildCurriculumClasses(raw: RawData): CurriculumClass[] {
  return Object.entries(raw.boards).flatMap(([board, b]) =>
    Object.entries(b.classes).map(([roman, c]) => ({
      board,
      roman,
      subjects: named(c.subjects)
        .map(subject => ({
          name: subject.name,
          chapters: named(subject.chapters).map(chapter => ({
            name: chapter.name,
            revisionNotes: withLinks(chapter.revisionNotes),
            topics: named(chapter.topics).map(topic => ({
              name: topic.name,
              interactiveClasses: withLinks(topic.interactiveClasses),
              videoLessons: withLinks(topic.videoLessons),
              activities: withActivities(topic.activities),
            })),
          })),
        }))
        // A subject with nothing to show is not a subject anyone can study:
        // Extramarks lists syllabuses it never published material for (ISC XI
        // and ISC XII Environmental Science and Home Science today), and an
        // empty card is a dead end that looks like a bug. Chapters are *not*
        // dropped this way — `?chapter=<index>` in a shared link points into
        // the chapter array, so removing one would shift every later link.
        .filter(subject => subject.chapters.some(hasChapterContent)),
    })),
  );
}

export function getCurriculumClass(board: string, roman: string) {
  return curriculumClasses.find(c => c.board === board && c.roman === roman);
}

export function findSubjectInClass(curriculumClass: CurriculumClass | undefined, name: string) {
  if (!curriculumClass) return undefined;
  const normalized = name.toLowerCase();
  return curriculumClass.subjects.find(s => s.name.toLowerCase() === normalized)
    ?? curriculumClass.subjects.find(s => normalized.startsWith(s.name.toLowerCase()) || s.name.toLowerCase().startsWith(normalized));
}

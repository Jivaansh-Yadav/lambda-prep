import { describe, expect, it } from "vitest";

import {
  buildCurriculumClasses,
  curriculumClasses,
  hasChapterContent,
  type Chapter,
  type RawData,
} from "./curriculum";

const emptyChapter: Chapter = { name: "Nothing published", topics: [] };

describe("hasChapterContent", () => {
  it("counts a revision note as content", () => {
    expect(
      hasChapterContent({ ...emptyChapter, revisionNotes: [{ name: "Notes", link: "https://example.com/n.pdf" }] }),
    ).toBe(true);
  });

  it("counts each kind of topic item", () => {
    const lesson = [{ name: "Lesson", link: "https://example.com/l" }];
    expect(
      hasChapterContent({ ...emptyChapter, topics: [{ name: "T", interactiveClasses: lesson, videoLessons: [], activities: [] }] }),
    ).toBe(true);
    expect(
      hasChapterContent({ ...emptyChapter, topics: [{ name: "T", interactiveClasses: [], videoLessons: lesson, activities: [] }] }),
    ).toBe(true);
    expect(
      hasChapterContent({
        ...emptyChapter,
        topics: [{ name: "T", interactiveClasses: [], videoLessons: [], activities: [{ type: "Lab", title: "Lab", link: "https://example.com/a" }] }],
      }),
    ).toBe(true);
  });

  it("treats a chapter with named topics but no items as empty", () => {
    expect(
      hasChapterContent({ ...emptyChapter, topics: [{ name: "T", interactiveClasses: [], videoLessons: [], activities: [] }] }),
    ).toBe(false);
    expect(hasChapterContent(emptyChapter)).toBe(false);
  });
});

describe("buildCurriculumClasses", () => {
  const raw: RawData = {
    boards: {
      ICSE: {
        classes: {
          X: {
            subjects: [
              {
                name: "Physics",
                chapters: [
                  { name: "Force", topics: [{ name: "Moments", interactiveClasses: [{ name: "Class", link: "https://example.com/c" }], videoLessons: [], activities: [] }] },
                  { name: "Untouched chapter", topics: [] },
                ],
              },
              {
                // Syllabus node with nothing published behind it.
                name: "Environmental Science",
                chapters: [{ name: "The syllabus", topics: [] }],
              },
              {
                // Named chapters, but every item is unlinkable.
                name: "Home Science",
                chapters: [
                  {
                    name: "Food",
                    topics: [
                      { name: "Nutrition", interactiveClasses: [{ name: "Class", link: "  " }], videoLessons: [], activities: [] },
                      { name: "Lab", interactiveClasses: [], videoLessons: [], activities: [{ type: "Lab", title: "Lab", link: "https://example.com/a", status: "BROKEN" }] },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };

  it("drops subjects with nothing to open", () => {
    const classX = buildCurriculumClasses(raw)[0]!;
    expect(classX.subjects.map(subject => subject.name)).toEqual(["Physics"]);
  });

  it("keeps empty chapters, because chapter links are positional", () => {
    const classX = buildCurriculumClasses(raw)[0]!;
    expect(classX.subjects[0]!.chapters.map(chapter => chapter.name)).toEqual([
      "Force",
      "Untouched chapter",
    ]);
  });
});

describe("the shipped dataset", () => {
  it("never exposes a subject with nothing to open", () => {
    for (const curriculumClass of curriculumClasses) {
      for (const subject of curriculumClass.subjects) {
        expect(
          subject.chapters.some(hasChapterContent),
          `${curriculumClass.board} ${curriculumClass.roman} → ${subject.name} has no content`,
        ).toBe(true);
      }
    }
  });
});

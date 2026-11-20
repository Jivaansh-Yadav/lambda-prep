import { describe, expect, it } from 'vitest';
import { buildDoxxIndex } from '@/lib/doxx-search';
import type { CurriculumClass } from '@/lib/curriculum';

const curriculum: CurriculumClass[] = [
  {
    board: 'ICSE',
    roman: 'X',
    subjects: [
      {
        name: 'Physics',
        chapters: [
          {
            name: 'Light',
            revisionNotes: [{ name: 'Light — Revision Notes', link: 'https://storage/light.pdf' }],
            topics: [
              {
                name: 'Refraction',
                interactiveClasses: [{ name: 'Refraction — Interactive Class', link: 'https://ex/1' }],
                videoLessons: [{ name: 'Refraction — Video', link: 'https://ex/2' }],
                activities: [{ type: 'Practice Game', title: 'Refraction — Practice Game', link: 'https://ex/3' }],
              },
            ],
          },
        ],
      },
    ],
  },
];

const classList = [{ slug: 'icse-10', board: 'ICSE', roman: 'X' }];

describe('buildDoxxIndex', () => {
  const index = buildDoxxIndex(curriculum, classList);

  it('indexes the class, subject, chapter, topic, lesson and note levels', () => {
    expect(index.map((entry) => entry.kind)).toEqual([
      'class',
      'subject',
      'chapter',
      'note',
      'topic',
      'interactive',
      'video',
      'activity',
    ]);
  });

  it('gives every lesson its index in the combined classes/videos/activities order', () => {
    const lessons = index.filter((entry) => entry.kind === 'interactive' || entry.kind === 'video' || entry.kind === 'activity');
    expect(lessons.map((entry) => entry.target.lesson)).toEqual([0, 1, 2]);
    // The topic the lesson lives in must ride along, or the deep link would
    // open the chapter instead of the player.
    expect(lessons[0]?.target).toEqual({ class: 'icse-10', subject: 'Physics', chapter: 0, topic: 0, lesson: 0 });
  });

  it('points a note at the chapter note index', () => {
    const note = index.find((entry) => entry.kind === 'note');
    expect(note?.target).toEqual({ class: 'icse-10', subject: 'Physics', chapter: 0, note: 0 });
  });

  it('skips classes the app has no slug for', () => {
    expect(buildDoxxIndex(curriculum, [])).toEqual([]);
  });

  it('carries searchable context, not just the bare name', () => {
    const topic = index.find((entry) => entry.kind === 'topic');
    expect(topic?.context).toContain('Light');
    expect(topic?.context).toContain('Physics');
  });
});

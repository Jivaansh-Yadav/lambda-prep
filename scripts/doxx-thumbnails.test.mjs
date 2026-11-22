import assert from "node:assert/strict";
import test from "node:test";

import {
  applyThumbs,
  stockWithinGroups,
  buildIndex,
  folderId,
  isUsableThumb,
  normalizeTitle,
  normalizeUrl,
} from "./drive-crawl/apply-doxx-thumbnails.mjs";

const THUMB = (name) => `https://storage.googleapis.com/emnewcontent/content_data/HTML/2022/12/16/111_dir/1/222/${name}`;

function classDoc(roman, subject, chapter, items) {
  return {
    class: { name: roman },
    subjects: [{ name: subject, chapters: [{ name: chapter, items }] }],
  };
}

test("normalizeUrl drops the query string, the trailing slash and a plain-http host", () => {
  assert.equal(
    normalizeUrl("http://mscontent-gcp.extramarks.com/a/b/index.html?x=1"),
    "https://mscontent-gcp.extramarks.com/a/b/index.html",
  );
  assert.equal(normalizeUrl("https://x.test/dir_1/index.html/"), "https://x.test/dir_1/index.html");
  assert.equal(normalizeUrl(undefined), "");
});

test("folderId reads both ownCloud folder spellings Extramarks uses", () => {
  assert.equal(folderId("https://x.test/content_data/HTML/2025/6/13/174979908100235224_dir_V001/1/a/index.html"), "174979908100235224");
  assert.equal(folderId("https://x.test/content_data/school_slm/2017/07/20/1739284/dir_1739284/index.html"), "1739284");
  assert.equal(folderId("https://x.test/content_data/Animation/x/output/video-hd.m3u8"), "");
});

test("normalizeTitle treats punctuation and case as noise", () => {
  assert.equal(normalizeTitle("Cell- Unit Of Life"), normalizeTitle("Cell: Unit of Life"));
  assert.equal(normalizeTitle("  Light  "), "light");
  assert.equal(normalizeTitle(undefined), "");
});

test("isUsableThumb rejects the ICSE digital-library splash every old SLM reuses", () => {
  assert.equal(isUsableThumb(THUMB("lesson.png")), true);
  assert.equal(isUsableThumb(THUMB("ICSEDL.jpg")), false);
  assert.equal(isUsableThumb(THUMB("extramarks_logo.png")), false);
  assert.equal(isUsableThumb(""), false);
  assert.equal(isUsableThumb(undefined), false);
});

test("applyThumbs joins interactive classes by URL, PDFs by folder id and videos by title", () => {
  const docs = [
    classDoc("X", "Physics", "Force", [
      {
        title: "Turning Effect",
        url: "https://mscontent-gcp.extramarks.com/content_data/school_slm/2020/01/01/900/dir_900/index.html",
        thumb: THUMB("interactive.jpg"),
      },
      {
        title: "Revision Notes",
        url: "https://storage.googleapis.com/emnewcontent/beta/content_data_private/PDF/2025/6/13/174979908100235224_dir_V001/1/x/notes.pdf",
        thumb: THUMB("notes.jpg"),
      },
      {
        // Same lesson, other rendition: only the folder id and the title survive.
        title: "Moment of Force",
        url: "https://mscontent-gcp.extramarks.com/content_data/Animation/2022/9/26/13655938841_dir/1/x/884.mp4",
        thumb: THUMB("moment.jpg"),
      },
      {
        title: "House Art Only",
        url: "https://mscontent-gcp.extramarks.com/content_data/other/index.html",
        thumb: THUMB("ICSEDL.jpg"),
      },
    ]),
  ];
  const index = buildIndex(docs);

  const curriculum = {
    boards: {
      ICSE: {
        classes: {
          X: {
            subjects: [
              {
                name: "Physics",
                chapters: [
                  {
                    name: "Force",
                    revisionNotes: [
                      {
                        name: "Revision Notes",
                        link: "https://storage.googleapis.com/emnewcontent/beta/content_data_private/PDF/2025/7/1/174979908100235224_dir_V002/1/y/renamed.pdf",
                      },
                    ],
                    topics: [
                      {
                        name: "Turning Effect of Force",
                        interactiveClasses: [
                          {
                            name: "Turning Effect",
                            link: "https://mscontent-gcp.extramarks.com/content_data/school_slm/2020/01/01/900/dir_900/index.html",
                          },
                        ],
                        videoLessons: [
                          {
                            name: "Moment of Force",
                            link: "https://mscontent-gcp.extramarks.com/content_data/crsemr/public/resources/video/2020/11/06/152890/output/Moment-hd.m3u8",
                          },
                        ],
                        activities: [
                          {
                            title: "House Art Only",
                            type: "Practice Game",
                            link: "https://mscontent-gcp.extramarks.com/content_data/other/index.html",
                          },
                          { title: "Uncatalogued Lab", type: "Virtual Lab", link: "https://mscontent-gcp.extramarks.com/content_data/nope/index.html" },
                        ],
                      },
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

  const stats = applyThumbs(curriculum, index);
  const chapter = curriculum.boards.ICSE.classes.X.subjects[0].chapters[0];
  const topic = chapter.topics[0];

  assert.equal(topic.interactiveClasses[0].thumb, THUMB("interactive.jpg"));
  assert.equal(topic.videoLessons[0].thumb, THUMB("moment.jpg"));
  assert.equal(chapter.revisionNotes[0].thumb, THUMB("notes.jpg"));
  // House art is not an index entry, so this falls through to no cover at all.
  assert.equal(topic.activities[0].thumb, undefined);
  assert.equal(topic.activities[1].thumb, undefined);

  assert.equal(stats.total, 5);
  assert.equal(stats.matched, 3);
  assert.equal(stats.byUrl, 1);
  assert.equal(stats.byFolder, 1);
  assert.equal(stats.byTitle, 1);
  assert.equal(stats.stock, 0);
  assert.deepEqual(stats.byKind.interactiveClasses, { total: 1, matched: 1, byTitle: 0, stock: 0 });
  assert.deepEqual(stats.byKind.videoLessons, { total: 1, matched: 1, byTitle: 1, stock: 0 });
  assert.deepEqual(stats.byKind.revisionNotes, { total: 1, matched: 1, byTitle: 0, stock: 0 });
  assert.deepEqual(stats.byKind.activities, { total: 2, matched: 0, byTitle: 0, stock: 0 });
});

test("stockWithinGroups drops an image that would repeat inside one topic", () => {
  const matches = [
    { group: "X|chapter|topic0", thumb: "https://x/a.png" },
    { group: "X|chapter|topic0", thumb: "https://x/b.png" },
    { group: "X|chapter|topic1", thumb: "https://x/b.png" },
  ];
  const hashes = new Map([
    ["https://x/a.png", "crc32c=dup"],
    ["https://x/b.png", "crc32c=dup"],
  ]);

  // The same bytes twice in topic0 is one splash on two cards, so both URLs go —
  // including the one that also shows up alone in topic1, since it is the same
  // picture either way.
  const stock = stockWithinGroups(matches, hashes, 2);
  assert.deepEqual([...stock].sort(), ["https://x/a.png", "https://x/b.png"]);
});

test("stockWithinGroups is strict for interactive classes and per-group elsewhere", () => {
  // Same bytes, one card in each of two topics: harmless for a video (never
  // shown together) but a house splash for an interactive class, where real
  // artwork is always one-off.
  const matches = [
    { kind: "interactiveClasses", group: "X|chapter|topic0", thumb: "https://x/splash.png" },
    { kind: "interactiveClasses", group: "X|chapter|topic1", thumb: "https://x/splash2.png" },
    { kind: "videoLessons", group: "X|chapter|topic0", thumb: "https://x/still.png" },
    { kind: "videoLessons", group: "X|chapter|topic1", thumb: "https://x/still2.png" },
  ];
  const hashes = new Map([
    ["https://x/splash.png", "crc32c=splash"],
    ["https://x/splash2.png", "crc32c=splash"],
    ["https://x/still.png", "crc32c=still"],
    ["https://x/still2.png", "crc32c=still"],
  ]);

  const stock = stockWithinGroups(matches, hashes, 2);
  assert.deepEqual([...stock].sort(), ["https://x/splash.png", "https://x/splash2.png"]);
});

test("applyThumbs never writes a stock cover and clears a stale one", () => {
  const index = buildIndex([
    classDoc("X", "Physics", "Force", [
      { title: "A", url: "https://x.test/a/index.html", thumb: THUMB("a.jpg") },
      { title: "B", url: "https://x.test/b/index.html", thumb: THUMB("b.jpg") },
    ]),
  ]);
  const curriculum = {
    boards: {
      ICSE: {
        classes: {
          X: {
            subjects: [
              {
                name: "Physics",
                chapters: [
                  {
                    name: "Force",
                    topics: [
                      {
                        name: "Turning",
                        interactiveClasses: [
                          { name: "A", link: "https://x.test/a/index.html", thumb: THUMB("stale.png") },
                          { name: "B", link: "https://x.test/b/index.html" },
                        ],
                      },
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

  const stats = applyThumbs(curriculum, index, { stock: new Set([THUMB("a.jpg")]) });
  const topic = curriculum.boards.ICSE.classes.X.subjects[0].chapters[0].topics[0];

  assert.equal(topic.interactiveClasses[0].thumb, undefined);
  assert.equal(topic.interactiveClasses[1].thumb, THUMB("b.jpg"));
  assert.equal(stats.matched, 1);
  assert.equal(stats.stock, 1);
});

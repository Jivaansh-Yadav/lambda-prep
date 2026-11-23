import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseTopic,
  findTopicMismatches,
  indexRemoteTopics,
  indexTopics,
  repairBucketedTopics,
} from "./sync-doxxmarks-videos.mjs";

const BUCKET = "More in this chapter";

function chapter(topics) {
  return {
    name: "Social context of Computing and Ethical issues",
    topics: topics.map(([name, videos = []]) => ({
      name,
      interactiveClasses: [],
      activities: [],
      videoLessons: videos.map((title) => ({ name: title, link: `https://cdn.test/${title}.mp4` })),
    })),
  };
}

function remote(items) {
  return { name: "Social context of Computing and Ethical issues", items };
}

function lesson(title, topic, metaTopic) {
  return { title, topic, family: "lesson", meta: metaTopic ? { Topic: metaTopic } : {} };
}

function place(ch, item) {
  const { topicByKey, topicByTitle } = indexTopics(ch);
  return chooseTopic(ch, item, topicByKey, topicByTitle, new Map());
}

function bucketOf(ch) {
  return ch.topics.find((topic) => topic.name === BUCKET);
}

test("a Nucleus film lands on its top-level topic even with no meta.Topic", () => {
  const ch = chapter([["Computer Crime"], ["Computer Ethics & Ethical Issues"]]);
  const topic = place(ch, lesson("Malware", "Computer Crime"));
  assert.equal(topic.name, "Computer Crime");
  assert.equal(bucketOf(ch), undefined);
});

test("the catalogue topic outranks a stale meta.Topic", () => {
  const ch = chapter([["Computer Crime"], ["Computer Ethics & Ethical Issues"]]);
  const topic = place(
    ch,
    lesson("Intellectual Property Rights", "Computer Ethics & Ethical Issues", "Computer Crime"),
  );
  assert.equal(topic.name, "Computer Ethics & Ethical Issues");
});

test("meta.Topic still places an item that carries no top-level topic", () => {
  const ch = chapter([["Hacking & Piracy"]]);
  assert.equal(place(ch, lesson("Hacking", undefined, "Hacking & Piracy")).name, "Hacking & Piracy");
});

test("a topic the chapter does not have falls back to the bucket, not a new topic", () => {
  const ch = chapter([["Computer Crime"]]);
  const topic = place(ch, lesson("Something else", "Cyber Security"));
  assert.equal(topic.name, BUCKET);
  assert.equal(ch.topics.length, 2);
});

test("a same-title sibling in the chapter wins over the bucket", () => {
  const ch = chapter([["Computer Crime", ["Malware"]]]);
  assert.equal(place(ch, lesson("Malware  ", undefined)).name, "Computer Crime");
});

test("a catalogue sibling topic fills a gap when the item itself is untagged", () => {
  const ch = chapter([["Computer Crime"]]);
  const remoteTopics = indexRemoteTopics(remote([lesson("Protection of information", "Computer Crime")]));
  const { topicByKey, topicByTitle } = indexTopics(ch);
  const topic = chooseTopic(ch, lesson("Protection of information", undefined), topicByKey, topicByTitle, remoteTopics);
  assert.equal(topic.name, "Computer Crime");
});

test("the repair pass moves bucketed videos onto the topic the catalogue names", () => {
  const ch = chapter([["Computer Crime"], [BUCKET, ["Malware", "Cyber Crime", "Truly untagged"]]]);
  const remoteTopics = indexRemoteTopics(
    remote([
      lesson("Malware", "Computer Crime"),
      lesson("Cyber Crime", "Computer Crime"),
      lesson("Truly untagged", ""),
    ]),
  );

  const result = repairBucketedTopics(ch, remoteTopics);

  assert.deepEqual(result, { moved: 2, left: 1, dropped: false });
  assert.deepEqual(
    ch.topics.find((topic) => topic.name === "Computer Crime").videoLessons.map((video) => video.name),
    ["Malware", "Cyber Crime"],
  );
  assert.deepEqual(bucketOf(ch).videoLessons.map((video) => video.name), ["Truly untagged"]);
});

test("the repair pass drops the bucket once it is empty", () => {
  const ch = chapter([["Computer Crime"], [BUCKET, ["Malware"]]]);
  const result = repairBucketedTopics(ch, indexRemoteTopics(remote([lesson("Malware", "Computer Crime")])));

  assert.deepEqual(result, { moved: 1, left: 0, dropped: true });
  assert.equal(bucketOf(ch), undefined);
});

test("the repair pass keeps a bucket that still holds an interactive class", () => {
  const ch = chapter([[BUCKET, ["Malware"]]]);
  bucketOf(ch).interactiveClasses.push({ name: "Explore", link: "https://cdn.test/explore.html" });
  const result = repairBucketedTopics(ch, indexRemoteTopics(remote([lesson("Malware", "Computer Crime")])));

  assert.equal(result.moved, 0, "no target topic exists in this chapter");
  assert.equal(result.dropped, false);
  assert.equal(bucketOf(ch).interactiveClasses.length, 1);
});

test("the repair pass is a no-op when the chapter has no bucket", () => {
  const ch = chapter([["Computer Crime", ["Malware"]]]);
  assert.deepEqual(repairBucketedTopics(ch, indexRemoteTopics(remote([lesson("Malware", "Computer Crime")]))), {
    moved: 0,
    left: 0,
    dropped: false,
  });
});

test("mismatches are reported without moving anything", () => {
  const ch = chapter([["Computer Crime", ["Hacking"]], ["Hacking & Piracy", ["Hacking 2"]]]);
  const mismatched = findTopicMismatches(ch, indexRemoteTopics(remote([lesson("Hacking", "Hacking & Piracy")])));

  assert.deepEqual(mismatched, [
    { title: "Hacking", filedUnder: "Computer Crime", catalogueNames: "Hacking & Piracy" },
  ]);
  assert.equal(ch.topics[0].videoLessons[0].name, "Hacking");
});

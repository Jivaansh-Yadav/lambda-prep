import { describe, expect, it } from "vitest";
import { MAX_PATTERN_LENGTH, checkPatternSafety } from "./regex-guard";

const unsafe = [
  "(a+)+",
  "(a*)*",
  "(\\d+)*",
  "(ab{2,})+",
  "(a|a)+",
  "(x|xy)*",
  "(a)\\1",
  "(\\w+\\s?)+$",
  "([a-z]+)+@",
];

const safe = [
  "prelim",
  "^class[- ]?10",
  "(pdf|docx)$",
  "prelims?",
  "^(?!.*draft).*qpaper.*$",
  "10{2,3}",
  "(\\d{1,2})",
  "chapter[\u2013-]\\d+",
  "\\[solution\\]",
  "a\\+b",
];

describe("checkPatternSafety", () => {
  it("rejects the catastrophic shapes", () => {
    for (const p of unsafe) {
      expect(checkPatternSafety(p), p).toMatchObject({ safe: false });
    }
  });

  it("accepts ordinary search patterns", () => {
    for (const p of safe) {
      expect(checkPatternSafety(p), p).toEqual({ safe: true });
    }
  });

  it("caps the pattern length", () => {
    expect(checkPatternSafety("a".repeat(MAX_PATTERN_LENGTH))).toEqual({ safe: true });
    expect(checkPatternSafety("a".repeat(MAX_PATTERN_LENGTH + 1))).toMatchObject({ safe: false });
  });

  it("does not mistake escaped brackets or plus signs for structure", () => {
    expect(checkPatternSafety("a\\)+")).toEqual({ safe: true });
  });
});

import { describe, expect, it } from "vitest";
import { MAX_BATCH, MAX_FILE_ID_LENGTH, parseFileIdBatch } from "./file-id-batch";

describe("parseFileIdBatch", () => {
  it("keeps the ids it is given, in order", () => {
    expect(parseFileIdBatch(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("trims and drops blanks and oversized ids instead of failing", () => {
    expect(parseFileIdBatch([" a ", "", "   ", "b"])).toEqual(["a", "b"]);
    expect(parseFileIdBatch(["x".repeat(MAX_FILE_ID_LENGTH + 1), "good"])).toEqual(["good"]);
    expect(parseFileIdBatch(["x".repeat(MAX_FILE_ID_LENGTH)])).toHaveLength(1);
  });

  it("de-duplicates", () => {
    expect(parseFileIdBatch(["a", "a", "b", "a"])).toEqual(["a", "b"]);
  });

  it("caps the batch", () => {
    const many = Array.from({ length: MAX_BATCH * 2 }, (_, i) => `id-${i}`);
    expect(parseFileIdBatch(many)).toHaveLength(MAX_BATCH);
  });

  it("counts unique ids toward the cap, not raw entries", () => {
    const padded = Array.from({ length: MAX_BATCH * 2 }, () => "same");
    expect(parseFileIdBatch(padded)).toEqual(["same"]);
  });

  it("rejects anything that is not an array of strings", () => {
    for (const bad of [null, undefined, "a,b", 42, {}, [1], [null], [{ id: "a" }]]) {
      expect(() => parseFileIdBatch(bad)).toThrow(/Invalid fileIds/);
    }
  });
});

import { describe, expect, it } from "vitest";
import { constantTimeEquals } from "./secure-compare";

describe("constantTimeEquals", () => {
  it("accepts identical strings", () => {
    expect(constantTimeEquals("hunter2", "hunter2")).toBe(true);
    expect(constantTimeEquals("", "")).toBe(true);
    expect(constantTimeEquals("pässcode-✓", "pässcode-✓")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(constantTimeEquals("hunter2", "hunter3")).toBe(false);
    expect(constantTimeEquals("hunter2", "")).toBe(false);
    expect(constantTimeEquals("", "hunter2")).toBe(false);
    expect(constantTimeEquals("Hunter2", "hunter2")).toBe(false);
    expect(constantTimeEquals("hunter2", "hunter2 ")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    // The classic bug: under/over-read throws or short-circuits; this must not.
    expect(constantTimeEquals("a", "aaaaaaaaaaaaaaaa")).toBe(false);
    expect(constantTimeEquals("aaaaaaaaaaaaaaaa", "a")).toBe(false);
  });

  it("compares bytes, not code units", () => {
    // "é" is two bytes in UTF-8 but one code unit — a naive char compare would
    // line these up with a different string of the same code-unit length.
    expect(constantTimeEquals("é", "Ã©")).toBe(false);
  });

  it("treats missing values as unequal to real secrets", () => {
    const missing = undefined as unknown as string;
    expect(constantTimeEquals(missing, "hunter2")).toBe(false);
    expect(constantTimeEquals("hunter2", missing)).toBe(false);
    expect(constantTimeEquals(null as unknown as string, "")).toBe(false);
  });
});
